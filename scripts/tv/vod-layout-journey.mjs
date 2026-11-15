/** Actual extracted-widget geometry/async journey; no production imports or playback. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Layout effects and ResizeObserver may settle after the selected row appears. */
export async function settleGeometry(read, frame) {
  let previous;
  for (let attempt = 0; attempt < 60; attempt++) {
    await frame();
    const value = await read();
    const encoded = JSON.stringify(value);
    if (encoded === previous) return value;
    previous = encoded;
  }
  throw new Error("VOD geometry did not settle");
}
export async function runVodLayouts({
  ev,
  capture,
  report,
  phase,
  mode,
  cdp,
  appUrl,
  checkpoint = () => {},
}) {
  const wait = async (expression) => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (await ev(expression)) return;
      await delay(80);
    }
    throw new Error(
      `VOD UI wait: ${expression}; ${await ev("document.body.innerText.slice(-500)")}`,
    );
  };
  const key = async (code) => {
    await ev(
      `(function(){var e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true});Object.defineProperty(e,'keyCode',{value:${code}});window.dispatchEvent(e);})()`,
    );
    await delay(80);
  };
  const frame = () =>
    ev(
      "new Promise(function(done){requestAnimationFrame(function(){requestAnimationFrame(done);});})",
    );
  const measure = async (name, selectors) => {
    if (name !== "loading")
      await ev("document.fonts ? document.fonts.ready.then(function(){return true;}) : true");
    const expression = `(function(){return ${JSON.stringify(selectors)}.map(function(s){return Array.prototype.map.call(document.querySelectorAll(s),function(e){var r=e.getBoundingClientRect();return [s,Math.round(r.left*10)/10,Math.round(r.top*10)/10,Math.round(r.width*10)/10,Math.round(r.height*10)/10];});});})()`;
    const read = () => ev(expression);
    const boxes = await settleGeometry(read, frame);
    if (boxes.some((rows) => !rows.length)) throw new Error(`Missing UI geometry: ${name}`);
    const legacy = await ev("document.documentElement.classList.contains('no-flex-gap')");
    if (!legacy) {
      // Neutralize gaps across actual containers, including new Home/setup rules.
      await ev(
        `(function(){var style=document.createElement('style');style.id='vod-gap-probe';style.textContent='*{row-gap:0!important;column-gap:0!important}';document.head.appendChild(style);document.documentElement.classList.add('no-flex-gap');})()`,
      );
      const fallback = await settleGeometry(read, frame);
      if (JSON.stringify(boxes) !== JSON.stringify(fallback)) {
        report.layoutFailure = { name, normal: boxes, fallback };
        throw new Error(`VOD gap parity: ${name}`);
      }
      await ev(
        "document.getElementById('vod-gap-probe').remove();document.documentElement.classList.remove('no-flex-gap')",
      );
    }
    report.layouts ??= [];
    report.layouts.push({
      name,
      boxes,
      gap: legacy ? "native legacy margins" : "gap and margin parity",
    });
    await capture(name);
  };
  if (phase === "home") {
    await measure("home", [".tile-tv", ".tile-movies", ".tile-series"]);
    const separated = await ev(
      `(function(){var a=document.querySelector('.tile-tv').getBoundingClientRect(),b=document.querySelector('.tile-movies').getBoundingClientRect(),c=document.querySelector('.tile-series').getBoundingClientRect();return document.documentElement.dir==='rtl' ? a.left-b.right>=30&&b.left-c.right>=23 : b.left-a.right>=30&&c.left-b.right>=23;})()`,
    );
    if (!separated) throw new Error("Home card spacing is missing");
    if (
      !(await ev(
        "Array.prototype.every.call(document.querySelectorAll('.home-tile-sub'),function(e){return e.scrollWidth<=e.clientWidth;})",
      ))
    )
      throw new Error("Home category count is clipped");
    if (
      !(await ev(
        "Array.prototype.every.call(document.querySelectorAll('.home-vod-content'),function(content){var title=content.querySelector('b'),count=content.querySelector('.home-tile-sub'),box=content.getBoundingClientRect(),t=title.getBoundingClientRect(),c=count.getBoundingClientRect();return title.textContent.length>0&&count.textContent.length>0&&title.textContent!==count.textContent&&t.top>=box.top-1&&t.bottom<=c.top+1&&c.bottom<=box.bottom+1&&title.scrollWidth<=title.clientWidth&&count.scrollWidth<=count.clientWidth;})",
      ))
    )
      throw new Error("Home title/count rows are clipped or overlap");
  }
  if (phase === "loading") {
    checkpoint("cold-headings");
    await wait(
      "document.querySelectorAll('.vod-cat').length>1&&document.querySelector('.vod-load').getAttribute('data-load-phase')==='request'",
    );
    if (
      !(await ev(
        "!document.querySelector('.vod-tile')&&document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')===null",
      ))
    )
      throw new Error(
        "Cold catalogue must not show partial success or a fabricated percentage",
      );
    if (
      !(await ev(
        "(function(){var label=document.querySelector('.vod-load-stage').getBoundingClientRect(),bar=document.querySelector('.vod-load i').getBoundingClientRect(),head=document.querySelector('.vod-headline').getBoundingClientRect();return label.top>=bar.bottom&&label.top-bar.bottom<=24&&label.bottom<=head.bottom&&!document.querySelector('.vod-right>.browse-status');})()",
      ))
    )
      throw new Error(
        "Loading stage must sit directly below the progress bar within the headline",
      );
    await measure("loading", [".vod-tabs", ".vod-load"]);
    await key(27);
    await wait("!document.querySelector('#view-vod')");
    if (!(await ev("!!document.querySelector('.tile-movies')"))) await key(27);
    await wait("!!document.querySelector('.tile-movies')");
    await ev("document.querySelector('.tile-movies').click()");
    await wait("!!document.querySelector('#view-vod .vod-load')");
    report.coldLoad = { headings: true, indeterminate: true, back: true, rejoined: true };
    mode.holdCatalog = false;
    for (const send of mode.waiting.splice(0)) send();
    checkpoint("cold-rejoined");
  }
  if (phase === "catalog") {
    if (report.coldLoad) {
      if (mode.requests.get_vod_streams !== 1)
        throw new Error("Reopening the cold catalogue duplicated its download");
      report.coldLoad.requests = mode.requests.get_vod_streams;
    }
    await measure("grid", [".vod-tabs", ".vod-cat", ".vod-tile", ".vod-az"]);
    const geometry = await ev(
      `(function(){var poster=document.querySelector('.vod-poster').getBoundingClientRect();return {poster:[poster.width,poster.height],tools:Array.prototype.every.call(document.querySelectorAll('.vod-tab'),function(e){var r=e.getBoundingClientRect();return r.left>=30&&r.right<=1873&&e.scrollWidth<=e.clientWidth;})};})()`,
    );
    if (geometry.poster[0] !== 208 || geometry.poster[1] !== 312 || !geometry.tools)
      throw new Error(`VOD sizing: ${JSON.stringify(geometry)}`);
    if (
      !(await ev(
        "Array.prototype.every.call(document.querySelectorAll('.vod-tile'),function(tile){var caption=tile.querySelector('.vod-name'),text=caption.querySelector('span'),box=tile.getBoundingClientRect(),c=caption.getBoundingClientRect(),r=text.getBoundingClientRect(),style=getComputedStyle(text);return c.width<=box.width&&r.left>=box.left-1&&r.right<=box.right+1&&style.overflow==='hidden'&&style.textOverflow==='ellipsis';})",
      ))
    )
      throw new Error("Grid caption escapes its own poster-width box");
    if (
      !(await ev(
        "(function(){var hint=document.querySelector('.vod-favourite-hint'),target=document.querySelector('.vod-title').textContent;return hint&&hint.textContent.trim().length>0&&(!target||hint.textContent.indexOf(target)<0)&&!!hint.querySelector('.remote-color-green')&&!hint.querySelector('button,[tabindex]');})()",
      ))
    )
      throw new Error("Favourite hint must show concise Green label without item title");
    const retainedGrid = await ev(
      "document.querySelector('#view-vod').setAttribute('data-retained-grid','yes'); true",
    );
    await ev("document.querySelectorAll('.vod-tab')[3].click()");
    await wait("!!document.querySelector('#view-vod input')");
    await key(13);
    if (!(await ev("!document.querySelector('#view-vod input').readOnly")))
      throw new Error("Grid search did not enter editing");
    await ev(
      "(function(){var field=document.querySelector('#view-vod input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'Z FINAL');field.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await wait("document.querySelectorAll('.vod-tile').length===1");
    await key(27);
    if (!(await ev("document.querySelector('#view-vod input').readOnly")))
      throw new Error("Return did not dismiss search editing");
    await key(27);
    await wait(
      "!document.querySelector('#view-vod input')&&document.querySelector('.vod-title').textContent==='Z FINAL'",
    );
    await key(404);
    await wait("document.querySelectorAll('.vod-favourite').length===1");
    await ev("document.querySelectorAll('.vod-cat')[1].click()");
    await delay(300);
    if (
      !(await ev(
        "document.querySelectorAll('.vod-tile').length===1&&document.querySelectorAll('.vod-cat')[1].classList.contains('active')",
      ))
    )
      throw new Error("Favourites filter reverted");
    await key(404);
    await delay(300);
    if (
      !(await ev(
        "document.querySelectorAll('.vod-tile').length===0&&document.querySelectorAll('.vod-cat')[1].classList.contains('active')",
      ))
    )
      throw new Error("Empty favourites filter reverted");
    await wait(
      "!!document.querySelector('.browse-status')&&!document.querySelector('.vod-tile')",
    );
    await measure("empty", [".browse-status", ".vod-tabs"]);
    await ev("document.querySelectorAll('.vod-cat')[0].click()");
    await delay(200);
    report.gridActions = {
      search: true,
      enterEditReturn: true,
      favourites: true,
      emptyFavourites: true,
      retainedGrid,
    };
    await ev(
      "Array.prototype.find.call(document.querySelectorAll('.vod-az b'),function(e){return e.textContent==='Z';}).click()",
    );
    await delay(80);
    mode.failDetail = true;
    await key(13);
    await wait("!!document.querySelector('#view-vod-details .browse-status button')");
    await measure("failure", [".media-appbar", ".browse-status"]);
    mode.failDetail = false;
    await key(13);
    await wait("!!document.querySelector('.media-play-action')");
    await measure("movie-detail", [".media-appbar", ".media-poster", ".media-play-action"]);
    if (
      !(await ev(
        "(function(){var dialog=document.querySelector('#view-vod-details'),grid=document.querySelector('#view-vod'),card=dialog.querySelector('.vod-movie-card').getBoundingClientRect();return grid&&grid.getAttribute('aria-hidden')==='true'&&grid.getAttribute('data-retained-grid')==='yes'&&dialog.getAttribute('role')==='dialog'&&dialog.contains(document.activeElement)&&card.width<=960&&card.height<=888;})()",
      ))
    )
      throw new Error("Movie modal did not retain the grid or contain focus");
    report.gridActions.movieModal = true;
    if (await ev("!!window.__nativePlaybackProbe")) {
      checkpoint("native-movie-start");
      await ev("document.querySelector('.media-play-action').click()");
      await wait("window.__nativePlaybackProbe.state==='PLAYING'");
      if (
        !(await ev(
          "/\\/movie\\/fixture\\/fixture\\/[0-9]+\\.mkv$/.test(window.__nativePlaybackProbe.urls.slice(-1)[0])&&window.__nativePlaybackProbe.rejectedHints===0",
        ))
      )
        throw new Error("Movie native handoff/container failed");
      report.nativePlayback = { movie: true };
      checkpoint("native-movie-catalogue");
      await key(27);
      await key(27);
      await wait(
        "!!document.querySelector('.vod-tile.focused')&&(document.querySelector('.vod-title')||{}).textContent==='Z FINAL'&&window.__nativePlaybackProbe.state==='PLAYING'&&!!document.querySelector('.vod-tab[data-tool=nowPlaying]')",
      );
      await ev("document.querySelector('.vod-tab[data-tool=nowPlaying]').click()");
      await wait("!document.querySelector('#view-vod')&&window.__nativePlaybackProbe.state==='PLAYING'");
      await key(413);
      await wait(
        "!!document.querySelector('.vod-tile.focused')&&(document.querySelector('.vod-title')||{}).textContent==='Z FINAL'&&window.__nativePlaybackProbe.state==='NONE'",
      );
      await ev("document.querySelector('.vod-tile.focused').click()");
      await wait("!!document.querySelector('.media-play-action')");
      checkpoint("native-failure-start");
      await ev(
        "window.__nativePlaybackProbe.fail=true;document.querySelector('.media-play-action').click()",
      );
      await wait("!!document.querySelector('.picture-state.failed')");
      if (
        !(await ev(
          "document.querySelector('.picture-state-code').textContent==='prepare/IDLE: PLAYER_ERROR_INVALID_PARAMETER'",
        ))
      )
        throw new Error("Missing safe native failure cause");
      checkpoint("native-failure-go-back");
      await key(13);
      await wait(
        "!!document.querySelector('.vod-tile.focused')&&(document.querySelector('.vod-title')||{}).textContent==='Z FINAL'&&window.__nativePlaybackProbe.state==='NONE'",
      );
      report.nativePlayback.failureGoBack = true;
      checkpoint("native-complete-before-reload");
      await ev("window.__nativePlaybackProbe.fail=false");
    }

    // Reload a genuine cached detail with an expired stamp and failing refresh.
    await delay(1000);
    mode.failDetail = true;
    await ev(
      "Object.keys(localStorage).filter(function(k){return k.indexOf('openiptv.at.xtream:')===0;}).forEach(function(k){localStorage.removeItem(k);})",
    );
    checkpoint("stale-reload");
    await cdp.send("Page.navigate", { url: appUrl }, 15000);
    checkpoint("stale-home");
    await wait("!!document.querySelector('.home-tile-channel')");
    await ev("document.querySelector('.tile-movies').click()");
    await wait("!!document.querySelector('.vod-tile')&&!document.querySelector('.vod-load')");
    await ev(
      "Array.prototype.find.call(document.querySelectorAll('.vod-az b'),function(e){return e.textContent==='Z';}).click()",
    );
    await delay(80);
    await key(13);
    await wait("!!document.querySelector('#view-vod-details .browse-status.stale')");
    await measure("stale", [".browse-status", ".media-play-action", ".media-poster"]);
    mode.failDetail = false;
    await ev("document.querySelector('.browse-status button').click()");
    await wait(
      "!!document.querySelector('.media-play-action')&&!document.querySelector('.browse-status')",
    );
    await key(27);
    await wait("!!document.querySelector('.vod-tile.focused')");
    await ev("document.querySelectorAll('.vod-tab')[2].click()");
    await wait(
      "!!document.querySelector('.media-list .row.selected')&&document.querySelector('.media-list .row.selected').textContent.indexOf('Z FINAL')>=0&&!document.querySelector('#view-vod')",
    );
    await measure("list", [".rail-content-switcher", ".media-list .row", ".panel-key"]);
    await ev("document.querySelector('[data-header-control=layout]').click()");
    await wait("!!document.querySelector('.vod-tile.focused')");
  }
  if (phase === "episodes") {
    const separated = await ev(
      "(function(){var rows=document.querySelectorAll('.sr-ep');if(rows.length<2)return false;var a=rows[0].getBoundingClientRect(),b=rows[1].getBoundingClientRect();return b.top-a.bottom>=7.9;})()",
    );
    if (!separated) throw new Error("Episode rows have no gutter");
    await measure("episodes", [".sr-actions", ".sr-seasons", ".sr-ep", ".sr-poster"]);
    if (await ev("!!window.__nativePlaybackProbe")) {
      checkpoint("native-episode-grid-start");
      await ev("document.querySelector('.sr-ep.focused').click()");
      await wait("window.__nativePlaybackProbe.state==='PLAYING'");
      if (
        !(await ev(
          "/\\/series\\/fixture\\/fixture\\/1000\\.mkv$/.test(window.__nativePlaybackProbe.urls.slice(-1)[0])",
        ))
      )
        throw new Error("Episode grid native identity/container failed");
      report.nativePlayback.episodeGrid = true;
      await key(27);
      await key(27);
      await wait(
        "!!document.querySelector('.sr-ep.focused')&&/:episode:1000$/.test(document.querySelector('.sr-ep.focused').getAttribute('data-episode-key'))&&window.__nativePlaybackProbe.state==='PLAYING'",
      );
      await ev("document.querySelector('.sr-now-playing').click()");
      await wait("!document.querySelector('#view-series')&&window.__nativePlaybackProbe.state==='PLAYING'");
      await key(413);
      await wait(
        "!!document.querySelector('.sr-ep.focused')&&/:episode:1000$/.test(document.querySelector('.sr-ep.focused').getAttribute('data-episode-key'))&&window.__nativePlaybackProbe.state==='NONE'",
      );
      report.nativePlayback.episodeReturn = true;
    }

    await ev("document.querySelectorAll('.sr-actions button')[1].click()");
    await wait(
      "!!document.querySelector('.media-list .row.selected .media-number')&&document.querySelector('.media-list .row.selected .media-number').textContent==='E1000'&&!document.querySelector('#view-series')",
    );
    await measure("episode-list", [".media-list .row", ".media-breadcrumb"]);
    if (await ev("!!window.__nativePlaybackProbe")) {
      checkpoint("native-episode-list-start");
      await ev("document.querySelector('.media-list .row.selected').click()");
      await wait("window.__nativePlaybackProbe.state==='PLAYING'");
      if (
        !(await ev(
          "/\\/series\\/fixture\\/fixture\\/1000\\.mkv$/.test(window.__nativePlaybackProbe.urls.slice(-1)[0])",
        ))
      )
        throw new Error("Episode list native identity/container failed");
      report.nativePlayback.episodeList = true;
    }
  }
}
