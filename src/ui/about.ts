/**
 * About page. Long-form vision content — written in a deliberately factual,
 * non-promotional voice. Structural facts are laid out; the reader does the
 * math themselves. No "this could be valuable", no roadmap, no pitch.
 */
export function mountAbout(host: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'view view-about';
  view.innerHTML = `
    <div class="view-header">
      <h2 class="view-title">About BrowserCoin</h2>
    </div>

    <article class="about-body">
      <p class="lead">
        BrowserCoin is a cryptocurrency that runs entirely in your browser.
        No installer. No exchange account. No wallet extension. Open the page,
        you have a wallet. Click <strong>Mine</strong>, your computer starts
        looking for blocks. Find one, the network credits you 50 BROWSER.
      </p>

      <p>
        This is an experiment. The coin has no price, no exchange listing,
        no fiat market, and probably never will. Nobody is selling you anything.
      </p>

      <h3>The rules</h3>
      <ul>
        <li>Total supply: <strong>21,000,000 BROWSER</strong>, ever.</li>
        <li>Block reward: <strong>50 BROWSER</strong>, halving every 210,000 blocks (~1 year at target pace).</li>
        <li>Target block time: <strong>2.5 minutes</strong>.</li>
        <li>Proof-of-work: <strong>memory-hard Argon2id (64 MB, 2 iterations)</strong>. Mineable on a laptop or phone. Hostile to GPUs and server farms.</li>
        <li>Account model ledger, Ed25519 signatures, 256 KB block cap, per-byte minimum fee.</li>
      </ul>

      <p>
        If those numbers look familiar — yes, the monetary policy is the same
        shape as Bitcoin's. Same supply, same halving schedule, four times
        the throughput. That's intentional.
      </p>

      <h3>What's not here</h3>
      <ul>
        <li>No founder allocation.</li>
        <li>No presale.</li>
        <li>No team tokens.</li>
        <li>No premine.</li>
        <li>No central authority signing blocks.</li>
        <li>No checkpoint server that can override consensus.</li>
        <li>No "tokenomics whitepaper" beyond what's on this page.</li>
      </ul>
      <p>Coins come into existence one way: someone mined them.</p>

      <h3>How to take part</h3>
      <ol>
        <li>Open <strong>browsercoin.org</strong>. You'll get a wallet on first visit, stored in your browser. Back it up under Settings.</li>
        <li>Click <strong>Mine</strong>. Your CPU starts grinding Argon2id hashes. When one lands below the current difficulty target, you've found a block.</li>
        <li>Show someone the <strong>QR code</strong> next to your address. They can scan it to send you coins.</li>
        <li>Tell a friend.</li>
      </ol>

      <p>
        The bootstrap server is a small Node process that helps browsers find
        each other and keeps an optional backup of the chain. It can't sign
        blocks, can't override consensus, and can't mint coins. You can swap
        it for any other bootstrap server under Settings, or run your own.
      </p>

      <h3>Why this exists</h3>
      <p>
        Most people who own cryptocurrency have never participated in one.
        They bought a number on an exchange. They never set up a node, never
        mined a block, never saw consensus code run. The thing they own is,
        to them, just a price.
      </p>
      <p>
        Bitcoin in 2009 was a few people running a client on their personal
        computers, finding blocks, getting 50 BTC for their trouble. Nobody
        had bought any. There was no chart. They were there because the
        experiment was interesting.
      </p>
      <p>
        That moment is over for Bitcoin. It isn't over for new chains.
      </p>
      <p>
        BrowserCoin is an attempt to make participation easy enough that the
        experiment is reachable again. Open a webpage, you're in. Run it on
        a phone on the bus. Find a block. See your block in the explorer
        with your address on it.
      </p>
      <p>
        If a lot of people end up participating, the network gets harder to
        attack and the chain starts to mean something. If only a few do, it
        was still a fun experiment. The coin costs nothing to mine besides
        electricity, and nobody is selling it to you. There's no version of
        this where someone gets hurt.
      </p>

      <h3>The code</h3>
      <p>
        MIT-licensed. The full client, server, consensus rules, and tests live at
        <a href="https://github.com/swompythesecond/BrowserCoin" target="_blank" rel="noopener noreferrer">github.com/swompythesecond/BrowserCoin</a>.
        Small enough to actually read.
      </p>
    </article>
  `;
  host.appendChild(view);
  return () => {};
}
