use argon2::{Algorithm, Argon2, Params, Version};
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;
use std::time::{Duration, Instant};

const HEADER_LEN: usize = 148;
const HASH_LEN: usize = 32;
const NONCE_OFFSET: usize = 112;
const SALT: &[u8] = b"browsercoin-pow-v5";
const MEMORY_KIB: u32 = 32 * 1024;
const ITERATIONS: u32 = 1;
const PARALLELISM: u32 = 1;

#[derive(Debug)]
struct Config {
    mode: Mode,
    header: Vec<u8>,
    target: Option<[u8; HASH_LEN]>,
    workers: usize,
    start_nonce: u32,
    stride: u32,
    stats_interval: Duration,
}

#[derive(Debug, Clone, Copy)]
enum Mode {
    Hash,
    Mine,
}

enum WorkerMsg {
    Stats {
        hashes: u64,
        elapsed: Duration,
    },
    Solved {
        nonce: u32,
        hash: [u8; HASH_LEN],
        header: Vec<u8>,
    },
    Exhausted,
    Error(String),
}

fn main() {
    match run() {
        Ok(()) => {}
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    }
}

fn run() -> Result<(), String> {
    let config = parse_args(env::args().skip(1).collect())?;
    match config.mode {
        Mode::Hash => {
            let hash = pow_hash(&config.header)?;
            println!("{{\"hash\":\"{}\"}}", hex_encode(&hash));
        }
        Mode::Mine => mine(config)?,
    }
    Ok(())
}

fn mine(config: Config) -> Result<(), String> {
    let target = config.target.ok_or("--target is required for mine")?;
    let stopped = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel::<WorkerMsg>();

    for i in 0..config.workers {
        let worker_tx = tx.clone();
        let stopped = Arc::clone(&stopped);
        let mut header = config.header.clone();
        let target = target;
        let start_nonce = config.start_nonce.wrapping_add(i as u32);
        let stride = config.stride;
        let stats_interval = config.stats_interval;

        thread::spawn(move || {
            let mut nonce = start_nonce;
            let mut hashes = 0u64;
            let mut window_start = Instant::now();
            loop {
                if stopped.load(Ordering::Relaxed) {
                    return;
                }
                write_nonce_be(&mut header, nonce);
                let hash = match pow_hash(&header) {
                    Ok(hash) => hash,
                    Err(err) => {
                        let _ = worker_tx.send(WorkerMsg::Error(err));
                        return;
                    }
                };
                hashes += 1;

                if hash_meets_target(&hash, &target) {
                    stopped.store(true, Ordering::Relaxed);
                    let _ = worker_tx.send(WorkerMsg::Solved {
                        nonce,
                        hash,
                        header,
                    });
                    return;
                }

                if window_start.elapsed() >= stats_interval {
                    let elapsed = window_start.elapsed();
                    let _ = worker_tx.send(WorkerMsg::Stats { hashes, elapsed });
                    hashes = 0;
                    window_start = Instant::now();
                }

                match nonce.checked_add(stride) {
                    Some(next) => nonce = next,
                    None => {
                        if hashes > 0 {
                            let elapsed = window_start.elapsed();
                            let _ = worker_tx.send(WorkerMsg::Stats { hashes, elapsed });
                        }
                        let _ = worker_tx.send(WorkerMsg::Exhausted);
                        return;
                    }
                }
            }
        });
    }
    drop(tx);

    let mut exhausted = 0usize;
    for msg in rx {
        match msg {
            WorkerMsg::Stats { hashes, elapsed } => {
                let hps = hashes as f64 / elapsed.as_secs_f64().max(0.001);
                println!(
                    "{{\"type\":\"stats\",\"hashes\":{},\"elapsedMs\":{},\"hashesPerSecond\":{:.2}}}",
                    hashes,
                    elapsed.as_millis(),
                    hps,
                );
            }
            WorkerMsg::Solved {
                nonce,
                hash,
                header,
            } => {
                println!(
                    "{{\"type\":\"solved\",\"nonce\":{},\"hash\":\"{}\",\"header\":\"{}\"}}",
                    nonce,
                    hex_encode(&hash),
                    hex_encode(&header),
                );
                return Ok(());
            }
            WorkerMsg::Exhausted => {
                exhausted += 1;
                if exhausted >= config.workers {
                    println!("{{\"type\":\"exhausted\"}}");
                    return Ok(());
                }
            }
            WorkerMsg::Error(err) => return Err(err),
        }
    }
    Ok(())
}

fn pow_hash(header: &[u8]) -> Result<[u8; HASH_LEN], String> {
    if header.len() != HEADER_LEN {
        return Err(format!("header must be {HEADER_LEN} bytes"));
    }
    let params = Params::new(MEMORY_KIB, ITERATIONS, PARALLELISM, Some(HASH_LEN))
        .map_err(|err| format!("argon2 params: {err}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; HASH_LEN];
    argon2
        .hash_password_into(header, SALT, &mut out)
        .map_err(|err| format!("argon2 hash: {err}"))?;
    Ok(out)
}

fn write_nonce_be(header: &mut [u8], nonce: u32) {
    header[NONCE_OFFSET] = (nonce >> 24) as u8;
    header[NONCE_OFFSET + 1] = (nonce >> 16) as u8;
    header[NONCE_OFFSET + 2] = (nonce >> 8) as u8;
    header[NONCE_OFFSET + 3] = nonce as u8;
}

fn hash_meets_target(hash: &[u8; HASH_LEN], target: &[u8; HASH_LEN]) -> bool {
    for i in 0..HASH_LEN {
        if hash[i] < target[i] {
            return true;
        }
        if hash[i] > target[i] {
            return false;
        }
    }
    false
}

fn parse_args(args: Vec<String>) -> Result<Config, String> {
    if args.is_empty() {
        return Err(usage());
    }

    let mode = match args[0].as_str() {
        "hash" => Mode::Hash,
        "mine" => Mode::Mine,
        "--help" | "-h" => return Err(usage()),
        other => return Err(format!("unknown mode: {other}\n\n{}", usage())),
    };

    let mut header: Option<Vec<u8>> = None;
    let mut target: Option<[u8; HASH_LEN]> = None;
    let mut workers = 1usize;
    let mut start_nonce = 0u32;
    let mut stride: Option<u32> = None;
    let mut stats_interval = Duration::from_secs(5);
    let mut i = 1usize;
    while i < args.len() {
        match args[i].as_str() {
            "--header" => {
                i += 1;
                header = Some(hex_decode(require_value(&args, i, "--header")?)?);
            }
            "--target" => {
                i += 1;
                let bytes = hex_decode(require_value(&args, i, "--target")?)?;
                if bytes.len() != HASH_LEN {
                    return Err("--target must be 32 bytes / 64 hex chars".to_string());
                }
                let mut arr = [0u8; HASH_LEN];
                arr.copy_from_slice(&bytes);
                target = Some(arr);
            }
            "--workers" => {
                i += 1;
                workers = parse_usize(require_value(&args, i, "--workers")?, "--workers")?;
                if workers == 0 {
                    return Err("--workers must be > 0".to_string());
                }
            }
            "--start-nonce" => {
                i += 1;
                start_nonce =
                    parse_u32(require_value(&args, i, "--start-nonce")?, "--start-nonce")?;
            }
            "--stride" => {
                i += 1;
                let n = parse_u32(require_value(&args, i, "--stride")?, "--stride")?;
                if n == 0 {
                    return Err("--stride must be > 0".to_string());
                }
                stride = Some(n);
            }
            "--stats-interval" => {
                i += 1;
                let secs = parse_f64(
                    require_value(&args, i, "--stats-interval")?,
                    "--stats-interval",
                )?;
                if secs <= 0.0 {
                    return Err("--stats-interval must be > 0".to_string());
                }
                stats_interval = Duration::from_secs_f64(secs);
            }
            "--help" | "-h" => return Err(usage()),
            other => return Err(format!("unknown option: {other}\n\n{}", usage())),
        }
        i += 1;
    }

    let header = header.ok_or("--header is required")?;
    if header.len() != HEADER_LEN {
        return Err(format!(
            "--header must be {HEADER_LEN} bytes / {} hex chars",
            HEADER_LEN * 2
        ));
    }
    let stride = stride.unwrap_or(workers as u32);

    Ok(Config {
        mode,
        header,
        target,
        workers,
        start_nonce,
        stride,
        stats_interval,
    })
}

fn require_value<'a>(args: &'a [String], index: usize, flag: &str) -> Result<&'a str, String> {
    args.get(index)
        .map(|s| s.as_str())
        .filter(|s| !s.starts_with("--"))
        .ok_or_else(|| format!("{flag} requires a value"))
}

fn parse_usize(s: &str, flag: &str) -> Result<usize, String> {
    s.parse::<usize>()
        .map_err(|_| format!("{flag} must be a positive integer"))
}

fn parse_u32(s: &str, flag: &str) -> Result<u32, String> {
    s.parse::<u32>()
        .map_err(|_| format!("{flag} must be a u32"))
}

fn parse_f64(s: &str, flag: &str) -> Result<f64, String> {
    s.parse::<f64>()
        .map_err(|_| format!("{flag} must be a number"))
}

fn hex_decode(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err("hex length must be even".to_string());
    }
    let mut out = Vec::with_capacity(hex.len() / 2);
    let bytes = hex.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = hex_nibble(bytes[i]).ok_or_else(|| format!("invalid hex at byte {i}"))?;
        let lo =
            hex_nibble(bytes[i + 1]).ok_or_else(|| format!("invalid hex at byte {}", i + 1))?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

fn usage() -> String {
    [
        "Usage:",
        "  browsercoin-rust-core hash --header <hex148>",
        "  browsercoin-rust-core mine --header <hex148> --target <hex32> [--workers N]",
        "",
        "PoW params are fixed to BrowserCoin v5 Argon2id: memory=32MiB, iterations=1, parallelism=1, salt=browsercoin-pow-v5.",
    ]
    .join("\n")
}
