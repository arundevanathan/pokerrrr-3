// Optional browser regression suite. Uses only disposable, intercepted local data.
// Run after build:staging; Playwright and a Chromium executable must be available.
const { chromium } = require(process.env.POKER_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), cp = require('child_process');
(async () => {
  const root = require('path').resolve(__dirname, '..');
  process.chdir(root);
  const { newRoom, command, startHand, view, finish } = await import(root + '/lib/poker.mjs'), { PROTOCOL_VERSION } = await import(root + '/lib/protocol/poker.mjs');
  const srv = cp.spawn(process.execPath, ['scripts/staging.mjs', 'preview'], { env: { ...process.env, CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  srv.stdout.on('data', d => logs += d);
  srv.stderr.on('data', d => logs += d);
  process.on('exit', () => { try {
    process.kill(-srv.pid, 'SIGTERM');
  }
  catch { } });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch('http://127.0.0.1:8787/api/health');
      if (r.ok) {
        ready = true;
        break;
      }
    }
    catch { }
    await new Promise(r => setTimeout(r, 500));
  }
  assert(ready, logs);
  const b = await chromium.launch({ headless: true, ...(process.env.POKER_BROWSER_EXECUTABLE ? { executablePath: process.env.POKER_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox'] });
  for (const [width, height, game, runs, seats = 8] of (process.env.POKER_RECOVERY_ONLY ? [] : [[320, 568, 'PLO5', 1], [390, 844, 'PLO5', 2], [430, 932, 'NLH', 1], [844, 390, 'PLO4', 1], [844, 390, 'PLO4', 2], [390, 740, 'NLH', 2, 6], [390, 740, 'PLO4', 2, 6], [390, 740, 'PLO5', 2, 6]]).filter(item=>!process.env.POKER_LAYOUT_HEIGHT||item[1]===Number(process.env.POKER_LAYOUT_HEIGHT))) {
    const p = await b.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
    let errs = [];
    p.on('pageerror', e => errs.push(e.message));
    const r = newRoom('UITEST', 'me', { name: 'Layout tester', sb: 25, bb: 50, buyin: 2500, seats, games: [game], rotation: 3, timer: 30 });
    for (let i = 1; i < seats; i++)
      command(r, 'p' + i, { type: 'join', name: 'Player ' + i, buyin: 2500 });
    r.paused = true;
    startHand(r, Date.now() - 10000);
    r.players[0].bet = 200;
    r.players[0].total = 200;
    r.players[0].stack = 2300;
    r.phase = 'flop'; r.board = r.deck.splice(-3);
    r.players[1].bet = 250; r.players[1].total = 250; r.players[1].stack = 2250; r.currentBet = 250;
    const lobby = { activeGame: { code: r.code, joined: true, players: r.players, settings: r.settings } }, state = () => ({ type: 'state', protocol: PROTOCOL_VERSION, lobby, room: view(r, 'me') });
    let socket;
    let bettingCommands = 0;
    const entries = [];
    await p.route('**/api/**', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/api/poker' && request.method() === 'POST') bettingCommands++;
      if (url.pathname === '/api/chat' && request.method() === 'POST') {
        const message = request.postDataJSON();
        const entry = { code: r.code, id: crypto.randomUUID(), sequence: entries.length + 1, kind: 'message', text: message.text, at: Date.now(), sender: { key: 'me', name: 'Layout tester', seat: 0 } };
        entries.push(entry);
        return route.fulfill({ json: { entry } });
      }
      const data = url.pathname === '/api/players' ? { players: [{ id: 'me', name: 'Layout tester' }] } : url.pathname === '/api/session' ? { player: { id: 'me', name: 'Layout tester' } } : url.pathname === '/api/lobby' ? lobby : url.pathname.includes('history') ? { games: [], nextCursor: null } : url.pathname === '/api/chat' ? { entries, nextCursor: null } : view(r, 'me');
      return route.fulfill({ json: data });
    });
    await p.routeWebSocket('**/api/poker/socket', ws => { socket = ws; ws.send(JSON.stringify(state())); ws.onMessage(raw => { if (JSON.parse(raw).type === 'ping') ws.send(JSON.stringify({protocol:PROTOCOL_VERSION,type:'pong'})); }); });
    await p.goto('http://127.0.0.1:8787');
    await p.waitForTimeout(1500);
    await p.locator('.personal-hole-cards .card').first().waitFor({ timeout: 5000 });
    await p.waitForTimeout(200);
    assert.equal(await p.locator('.topbar .chat-toggle').count(), 0);
    const wager = await p.locator('.your-seat .seat-bet').boundingBox(), hero = await p.locator('.your-seat .seat-info').boundingBox();
    assert(wager && wager.y + wager.height <= hero.y, 'Hero bet stays above nameplate');
    const peek = await p.locator('.your-seat').evaluate(e => { const card = e.querySelector('.card.back').getBoundingClientRect(), name = e.querySelector('.seat-info').getBoundingClientRect(); return name.top - card.top; });
    assert(peek >= 6 && peek <= 14, 'Card-back peek: ' + peek);
    assert.equal(await p.locator('.turn-beam.is-active').count(), 1);
    const firstAngle = await p.locator('.turn-beam-direction').getAttribute('style');
    r.turn = r.players[4].id;
    r.version++;
    socket.send(JSON.stringify(state()));
    await p.waitForTimeout(350);
    const lastAngle = await p.locator('.turn-beam-direction').getAttribute('style');
    assert.notEqual(firstAngle, lastAngle, 'Beam rotates when actor changes');
    await p.screenshot({ path: `/tmp/dunzo-ui-${width}-normal.png` });
    const queuedCall = () => p.getByRole('checkbox', {name:'Call 50',exact:true});
    await queuedCall().click();
    assert.equal(await queuedCall().getAttribute('aria-checked'),'true');
    assert.equal(bettingCommands,0,'Selecting pre-call sends no action');
    r.version++; socket.send(JSON.stringify(state())); await p.waitForTimeout(100);
    assert.equal(await queuedCall().getAttribute('aria-checked'),'true','Another call/version update preserves pre-call');
    r.currentBet=300;r.players[1].bet=300;r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    assert.equal(await p.getByRole('checkbox',{name:'Call 100',exact:true}).getAttribute('aria-checked'),'false','Raise cancels pre-call');
    const checkFold=p.getByRole('checkbox',{name:'Check / Fold',exact:true});
    await checkFold.click();r.currentBet=350;r.players[1].bet=350;r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    assert.equal(await checkFold.getAttribute('aria-checked'),'true','Check/fold survives raises');
    await checkFold.click();assert.equal(await checkFold.getAttribute('aria-checked'),'false','Second tap clears selection');
    r.players[0].bet=350;r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    await p.getByRole('checkbox',{name:'Check',exact:true}).click();
    r.currentBet=400;r.players[1].bet=400;r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    assert.equal(await p.getByRole('checkbox',{name:'Call 50',exact:true}).getAttribute('aria-checked'),'false','Bet cancels pre-check');
    await queuedCall().click();
    await p.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));});
    await p.waitForTimeout(100);assert.equal(await queuedCall().getAttribute('aria-checked'),'false','Disconnect clears preselection');
    await p.evaluate(()=>{delete navigator.onLine;window.dispatchEvent(new Event('online'));});
    socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    // Restore the original wager fixture before the phase/layout transitions.
    r.players[0].bet=200;r.players[1].bet=250;r.currentBet=250;r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    const geometry=async()=>Promise.all(['.felt','.table-stage','.action-zone','.your-seat .seat-info'].map(selector=>p.locator(selector).boundingBox()));
    const stableGeometry=await geometry();
    const firstBoard=()=>p.locator('.board-cards').first().boundingBox();
    const stableBoard=await firstBoard();
    const stableButtons=await p.locator('.action-buttons').boundingBox();
    r.terminationPending=true;r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    assert.deepEqual(await p.locator('.action-buttons').boundingBox(),stableButtons,'Termination notice cannot move action buttons');
    assert(stableButtons.y+stableButtons.height<=height,'All controls visible with termination pending');
    r.terminationPending=false;r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    for(const seat of await p.locator('.seat:has(.seat-bet)').all()){
      const direction=await seat.getAttribute('data-bet-direction'),name=await seat.locator('.seat-info').boundingBox(),bet=await seat.locator('.seat-bet').boundingBox();
      const isSelf=await seat.evaluate(e=>e.classList.contains('your-seat'));
      assert(isSelf?bet.y+bet.height<=name.y:bet.y>=name.y+name.height&&bet.y<=name.y+name.height+4,'Own wager above; opponents close below');
      assert(Math.abs(bet.x+bet.width/2-(name.x+name.width/2))<.5,'Every wager is centred under player');
      const stage=await p.locator('.table-stage').boundingBox();
      assert(bet.y+bet.height<=stage.y+stage.height+.5,'Wager remains fully above controls');
      for(const card of await p.locator('.board-cards .card').all()){const c=await card.boundingBox();assert(bet.x+bet.width<=c.x||c.x+c.width<=bet.x||bet.y+bet.height<=c.y||c.y+c.height<=bet.y,'Wager clear of community cards');}
    }
    r.phase='runout_vote';r.runVote={deadline:Date.now()+60000,opensAt:Date.now()-1,canTwice:true,revealed:false,voters:r.players.map(player=>({id:player.id,name:player.name,choice:null}))};r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(150);
    assert.equal(await p.getByRole('region',{name:'Choose runout count'}).count(),1);
    assert.deepEqual(await firstBoard(),stableBoard,'Voting keeps board fixed');
    assert.deepEqual(await geometry(),stableGeometry,'Voting does not resize felt, panel or move hero seat');
    r.phase='flop';r.runVote=null;r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    assert.deepEqual(await geometry(),stableGeometry,'Returning from vote does not resize table');

    await p.getByRole('button', { name: 'Table menu', exact: true }).click();
    assert.equal(await p.locator('.menu-list>button').count(), 6);
    await p.getByRole('button', { name: 'Terminate Game', exact: true }).click();
    const box = await p.getByRole('dialog').getByRole('button', { name: 'Terminate Game', exact: true }).boundingBox();
    assert(box.y >= 0 && box.y + box.height <= height, 'Confirmation visible');
    await p.getByRole('button', { name: 'Cancel', exact: true }).click();
    await p.getByRole('button', { name: 'Close', exact: true }).click();
    await queuedCall().click();
    const automaticCall=p.waitForRequest(request=>request.url().endsWith('/api/poker')&&request.method()==='POST');
    r.turn = 'me'; r.deadline = Date.now() + 30000; r.version++; socket.send(JSON.stringify(state()));
    const sentPrecall=await automaticCall;assert.equal(sentPrecall.postDataJSON().type,'call');
    await p.waitForTimeout(150);socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    assert.equal(bettingCommands,1,'Selected pre-call executes exactly once');
    assert.equal(await p.getByRole('checkbox').count(),0,'Current-turn controls have no checkbox');
    bettingCommands=0;

    await p.waitForTimeout(100);
    await p.getByRole('button', { name: 'Write a message', exact: true }).click();
    await p.locator('#chat-message').fill('Keep this draft');
    if (height > 600)
      await p.setViewportSize({ width, height: 460 });
    await p.waitForTimeout(200);
    const bounds = await p.locator('.action-buttons,.chat-composer,.personal-hand,.table-stage').evaluateAll(es => es.map(e => ({ cls: e.className, top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom, client: e.clientHeight, scroll: e.scrollHeight })));
    const vh = p.viewportSize().height;
    for (const e of bounds)
      assert(e.top >= 0 && e.bottom <= vh, JSON.stringify({ width, height, vh, e }));
    const composer = await p.locator('.chat-composer').boundingBox();
    assert(composer.width <= width * .95, 'Composer fits inside the typing view: '+JSON.stringify({width,height,composer}));
    assert.equal(await p.locator('.topbar').isVisible(), false, 'Brand header hidden while typing');
    assert.equal(await p.locator('.slider-shortcuts').isVisible(), false, 'Raise slider hidden while typing');
    assert.equal(await p.locator('.seat-info').first().isVisible(), false, 'Seat arrangement hidden while typing');
    assert.equal(await p.locator('.action-buttons').evaluate(e => getComputedStyle(e).boxShadow), 'none', 'No group selection outline');
    const boardBounds = await p.locator('.table-stage').boundingBox();
    const cards = await p.locator('.table-stage .board-cards .card').evaluateAll(es => es.map(e => { const b = e.getBoundingClientRect(); return {top:b.top,bottom:b.bottom,left:b.left,right:b.right}; }));
    assert.equal(cards.length, 5);
    for (const card of cards) assert(card.top >= boardBounds.y && card.bottom <= boardBounds.y + boardBounds.height && card.left >= 0 && card.right <= width, 'Entire community board visible');
    // A native keyboard can pan as well as resize the visual viewport.
    await p.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'offsetTop', { configurable:true, get:()=>25 });
      Object.defineProperty(window.visualViewport, 'height', { configurable:true, get:()=>window.innerHeight-25 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await p.waitForTimeout(100);
    const panned = await p.locator('.app').boundingBox();
    assert.equal(panned.y,25,'App follows native visual viewport panning');
    assert(panned.y+panned.height<=vh,'Panned app remains above keyboard');
    await p.evaluate(() => {
      delete window.visualViewport.offsetTop; delete window.visualViewport.height;
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await p.waitForTimeout(100);
    await p.screenshot({ path: `/tmp/dunzo-ui-${width}-typing.png` });
    await p.getByRole('button', { name: 'Expand chat history' }).click();
    assert.equal(await p.getByRole('dialog', { name: 'Game chat history' }).count(), 1);
    await p.getByRole('button', { name: 'Back to game', exact: true }).click();
    await p.getByRole('button', { name: 'Write a message', exact: true }).click();
    assert.equal(await p.locator('#chat-message').inputValue(), 'Keep this draft');
    await p.getByRole('button', { name: 'Raise…', exact: true }).click();
    assert.equal(await p.locator('#chat-message').count(), 0, 'Raise closes the composer');
    assert.equal(await p.locator('.slider-shortcuts').isVisible(), true, 'Raise opens normal amount selection');
    assert.equal(bettingCommands, 0, 'First Raise tap never sends a bet');
    await p.getByRole('button', { name: 'Write a message', exact: true }).click();
    assert.equal(await p.locator('#chat-message').inputValue(), 'Keep this draft', 'Raise handoff retains draft');
    const actionReply = p.waitForResponse(response => response.url().endsWith('/api/poker') && response.request().method()==='POST');
    await p.getByRole('button', {name:'Call 50',exact:true}).click();
    await actionReply;
    assert.equal(bettingCommands,1,'Call works on the first tap while typing');
    assert.equal(await p.locator('#chat-message').inputValue(),'Keep this draft','Betting retains the draft');
    const sent = p.waitForResponse(response => response.url().includes('/api/chat') && response.request().method() === 'POST');
    await p.getByRole('button', { name: 'Send message' }).click();
    assert.equal(await p.locator('#chat-message').count(), 0, 'Composer closes immediately after Send');
    await sent;
    assert.equal(entries.length, 1);
    await p.setViewportSize({ width, height });
    await p.waitForTimeout(150);
    await p.locator('.speech-bubble').waitFor({state:'hidden',timeout:15000});
    const beforeShowdownGeometry = await geometry();
    const beforeShowdownBoard=await firstBoard();
    r.board = r.deck.slice(0, 5);
    if (runs === 2) {
      r.runBoards = [r.board, r.deck.slice(5, 10)];
      r.runCount = 2;
    }
    for (const player of r.players) {
      player.total = 100;
      player.bet = 100;
      player.stack = 2400;
    }
    finish(r, false, Date.now() - 30000);
    r.serverTime = Date.now();
    socket.send(JSON.stringify(state()));
    await p.waitForTimeout(500);
    assert.deepEqual(await firstBoard(),beforeShowdownBoard,'Showdown/second board/winner cannot move or resize first board');
    assert.deepEqual(await geometry(),beforeShowdownGeometry,'Showdown/result text does not resize felt or bottom panel');
    assert(await p.locator('.table-winning-hand').count() > 0);
    assert.equal(await p.locator('.card.winning-card').count(), 5);
    assert.equal(await p.locator('.seat.acting').count(), 0);
    const placement = await p.locator('.runout-boards').evaluate(e => { const cards = [...e.querySelectorAll('.board-cards')].at(-1).getBoundingClientRect(), award = e.querySelector('.board-results').getBoundingClientRect(); return { cards: cards.bottom, result: award.top, bottom: award.bottom }; });
    assert(placement.result >= placement.cards, 'Win info below board');
    assert.equal(await p.locator('.action-zone .table-awards').count(), 0);
    if(height>700&&await p.locator('.board-results .table-award-winners > div').count()===1){
      const readableResult=await p.locator('.board-results').evaluate(e=>({client:e.clientHeight,scroll:e.scrollHeight,text:e.textContent}));
      assert(readableResult.scroll<=readableResult.client+1,'One winner and hand description visible without scrolling: '+JSON.stringify(readableResult));
      const unmasked=await p.locator('.table-winning-hand').evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);return [...range.getClientRects()].flatMap(b=>[b.left+2,b.left+b.width/2,b.right-2].map(x=>({ok:Boolean(document.elementFromPoint(x,b.top+b.height/2)?.closest('.board-results')),x,y:b.top+b.height/2,target:document.elementFromPoint(x,b.top+b.height/2)?.outerHTML.slice(0,150),text:e.textContent})));});
      assert(unmasked.every(p=>p.ok),'Felt curve and seats cannot mask result text: '+JSON.stringify(unmasked));
    }

    assert.equal(await p.locator('.turn-beam.is-active').count(), 0);
    await p.screenshot({ path: `/tmp/dunzo-readable-${width}-${height}-${game}-winner.png` });
    if(runs===2){
      const rows=await p.locator('.board-cards').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom};}));
      assert(rows[1].top-rows[0].bottom<=14,'Two boards have a compact gap');
      const ownSeat=await p.locator('.your-seat .seat-top').boundingBox();
      assert(placement.bottom<=ownSeat.y,'Both boards and result clear the local seat: '+JSON.stringify({placement,ownSeat}));
      await p.getByRole('button',{name:'Run 1',exact:true}).click();
      assert.equal(await p.getByRole('button',{name:'Run 1',exact:true}).getAttribute('aria-pressed'),'true');
      assert.deepEqual(await firstBoard(),beforeShowdownBoard,'Switching run result cannot move cards');
      await p.getByRole('button',{name:'Run 2',exact:true}).click();
    }
    const indices=await p.locator('.cards-revealed .hole-cards').evaluateAll(groups=>groups.flatMap(group=>[...group.querySelectorAll('.card')].map((card,i,cards)=>{
      const face=card.getBoundingClientRect(),rank=card.querySelector('b').getBoundingClientRect(),suit=card.querySelector('span').getBoundingClientRect(),next=cards[i+1]?.getBoundingClientRect();
      return {face:{left:face.left,right:face.right,top:face.top,bottom:face.bottom},rank:{left:rank.left,right:rank.right,top:rank.top,bottom:rank.bottom},suit:{left:suit.left,right:suit.right,top:suit.top,bottom:suit.bottom},next:next?.left};
    })));
    assert(indices.length>0,'Opponent cards are revealed');
    const communityFaces=await p.locator('.board-cards .card').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};}));
    for(const {face,rank,suit,next} of indices){
      for(const board of communityFaces) assert(face.right<=board.left+.5||board.right<=face.left+.5||face.bottom<=board.top+.5||board.bottom<=face.top+.5,'Opponent face clear of community cards: '+JSON.stringify({width,height,face,board}));
      for(const mark of [rank,suit]){
        assert(mark.left>=0&&mark.right<=width,'Card indices stay on screen: '+JSON.stringify({width,height,face,rank,suit,next}));
        assert(mark.left>=face.left&&mark.right<=face.right+.5&&mark.top>=face.top&&mark.bottom<=face.bottom+.5,'Rank/suit contained in card: '+JSON.stringify({width,height,face,rank,suit,next}));
        assert(next===undefined||mark.right<=next+.5,'Neighbouring card cannot cover rank or suit: '+JSON.stringify({width,height,face,rank,suit,next}));
      }
    }
    await p.screenshot({ path: `/tmp/dunzo-readable-${width}-${height}-${game}-winner.png` });
    r.phase='closed';r.terminationPending=false;r.version++;socket.send(JSON.stringify(state()));await p.waitForTimeout(100);
    for(const button of await p.locator('.game-ended-actions button').all()){const box=await button.boundingBox();assert(box.y>=0&&box.y+box.height<=height,'Ended-game navigation visible');}
    assert.deepEqual(errs, []);
    await p.close();
    console.log(`PASS ${width}×${height} ${game}, ${runs} board(s)`);
  }
  if(!process.env.POKER_LAYOUT_HEIGHT) await require('./recovery-browser.cjs')(b, root);
  await b.close();
  try { process.kill(-srv.pid, 'SIGTERM'); } catch { }
  srv.stdout.destroy(); srv.stderr.destroy(); srv.unref();
})().catch(e => { console.error(e); process.exit(1); });
