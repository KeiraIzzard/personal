(function(){
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Chapter tracking + UV gauge ---------- */
  var body = document.body;
  var gaugeFill = document.getElementById('gaugeFill');
  var gaugeValue = document.getElementById('gaugeValue');
  var gaugeCaption = document.getElementById('gaugeCaption');

  var displayedUV = 0;
  var targetUV = 0;
  var maxUV = 12; // scale ceiling for the dial (gauge reads 0–12)

  var uvColors = [
    {max:2,  color:'var(--gauge-low)'},
    {max:5,  color:'var(--gauge-mod)'},
    {max:7,  color:'var(--gauge-high)'},
    {max:10, color:'var(--gauge-vhigh)'},
    {max:99, color:'var(--gauge-extreme)'}
  ];

  function colorForUV(v){
    for (var i=0;i<uvColors.length;i++){
      if (v <= uvColors[i].max) return uvColors[i].color;
    }
    return uvColors[uvColors.length-1].color;
  }

  function setGauge(v){
    var pct = Math.max(0, Math.min(1, v / maxUV));
    var dash = (pct * 75).toFixed(1); // 75 = arc length matching the track's dasharray
    gaugeFill.setAttribute('stroke-dasharray', dash + ' 100');
    gaugeFill.style.stroke = colorForUV(v);
    gaugeValue.textContent = Math.round(v);
  }

  function tick(){
    displayedUV += (targetUV - displayedUV) * (reduceMotion ? 1 : 0.08);
    if (Math.abs(targetUV - displayedUV) < 0.02) displayedUV = targetUV;
    setGauge(displayedUV);
    window.IH = window.IH || {};
    window.IH.uv = displayedUV;   // read by sound.js to set the tick speed
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  var chapterSections = document.querySelectorAll('[data-chapter]');
  var captions = {
    hero: '',
    morning: 'Barely there',
    commute: 'Protection needed from 3',
    lunch: 'Peak UV window',
    arvo: "Today's high",
    evening: "Today's total",
    reveal: 'Invisible, not harmless',
    closing: 'Every day, not just hot ones'
  };

  var chapterObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting && entry.intersectionRatio > 0.5){
        var ch = entry.target.getAttribute('data-chapter');
        body.setAttribute('data-chapter', ch);
        var uvAttr = entry.target.getAttribute('data-uv');
        if (uvAttr !== null) targetUV = parseFloat(uvAttr);
        gaugeCaption.textContent = captions[ch] || '';
      }
    });
  }, { threshold: [0.5] });

  chapterSections.forEach(function(s){ chapterObserver.observe(s); });

  /* ---------- Chapter text reveal ---------- */
  var textBlocks = document.querySelectorAll('.chapter-inner');
  var textObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting) entry.target.classList.add('is-visible');
    });
  }, { threshold: 0.35 });
  textBlocks.forEach(function(b){ textObserver.observe(b); });

  /* ---------- Reveal-section figure crossfade ---------- */
  var revealSection = document.getElementById('revealSection');
  var revealObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting && entry.intersectionRatio > 0.45){
        revealSection.classList.add('is-active');
      }
    });
  }, { threshold: [0.45] });
  revealObserver.observe(revealSection);

  /* ---------- Skin photo: fall back to the UV texture if the photo is missing ---------- */
  var skinPhoto = document.getElementById('skinPhoto');
  if (skinPhoto){
    var test = new Image();
    test.onerror = function(){ skinPhoto.remove(); };
    test.src = skinPhoto.getAttribute('href');
  }

  /* ---------- Sun arc across the whole page ---------- */
  var sun = document.getElementById('sun');
  var sunTrack = document.querySelector('.sun-track');
  var docHeight = 0;
  var vw = 0, vh = 0;

  function measure(){
    docHeight = document.documentElement.scrollHeight - window.innerHeight;
    vw = window.innerWidth;
    vh = window.innerHeight;
  }
  measure();
  window.addEventListener('resize', measure);

  var ticking = false;
  function positionSun(){
    ticking = false;
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var progress = docHeight > 0 ? scrollTop / docHeight : 0;
    progress = Math.max(0, Math.min(1, progress));

    // sunrise -> zenith -> sunset arc across roughly the first 70% of scroll,
    // then the sun sets away by the time the reveal section arrives.
    var arcT = Math.min(progress / 0.68, 1);
    var x = arcT * (vw * 0.86) + vw * 0.02;
    // the sun rises from behind the globe and arcs through the band between the text and the horizon
    var arcHeight = vh * 0.30;
    var y = (vh * 0.86) - Math.sin(arcT * Math.PI) * arcHeight;

    var scale = 0.7 + Math.sin(arcT * Math.PI) * 0.35;
    var fade = progress > 0.62 ? Math.max(0, 1 - (progress - 0.62) / 0.12) : 1;

    sun.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(' + scale + ')';
    sun.style.opacity = fade;
  }

  function onScroll(){
    if (!ticking){
      ticking = true;
      requestAnimationFrame(positionSun);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  positionSun();

  /* ---------- Day globe: rotates one scene per chapter as you scroll ---------- */
  var globeRing = document.getElementById('globeRing');
  var globeScenes = document.querySelectorAll('.globe-scene');
  var globeChapters = ['morning', 'commute', 'lunch', 'arvo', 'evening'].map(function(name){
    return document.querySelector('.chapter[data-chapter="' + name + '"]');
  });
  var STEP = 30;               // degrees between scenes — recalculated from the globe's size
  var chapterMids = [];
  var globeAngle = 0;
  var globeTarget = 0;
  var currentScene = -1;

  function measureGlobe(){
    // space the scenes around the rim so the next one just peeks over the horizon
    var globe = document.querySelector('.day-globe');
    var radius = globe.offsetWidth / 2;
    var sceneW = globeScenes[0].offsetWidth;
    STEP = (sceneW * 1.15 / radius) * 180 / Math.PI;
    globeScenes.forEach(function(el, k){ el.style.setProperty('--a', (k * STEP) + 'deg'); });

    // Each scene stands on a gentle mound that blends into the curve of the globe,
    // so nothing floats above the horizon at the edges of the artwork.
    var R = radius * 320 / sceneW;            // globe radius in the artwork's units
    function rim(x){ var dx = x - 160; return 199 + (R - Math.sqrt(Math.max(0, R * R - dx * dx))); }
    function top(x){
      if (x >= 20 && x <= 300) return 192;
      var t = x < 20 ? Math.min(1, (20 - x) / 150) : Math.min(1, (x - 300) / 150);
      t = t * t * (3 - 2 * t);                // smoothstep
      return 192 + (rim(x) - 192) * t;
    }
    var pts = [], x;
    for (x = -140; x <= 460; x += 10) pts.push(x + ' ' + Math.min(top(x), rim(x)).toFixed(1));
    for (x = 460; x >= -140; x -= 10) pts.push(x + ' ' + (rim(x) + 80).toFixed(1));
    var d = 'M' + pts.join(' L') + 'Z';
    document.querySelectorAll('.globe-scene .ground').forEach(function(g){ g.setAttribute('d', d); });

    chapterMids = globeChapters.map(function(sec){
      var r = sec.getBoundingClientRect();
      return r.top + window.scrollY + r.height / 2;
    });
  }

  // Works out where you are between chapters as a decimal (0 = morning, 4 = evening)
  function globeProgress(){
    var mid = window.scrollY + window.innerHeight / 2;
    if (mid <= chapterMids[0]) return 0;
    var last = chapterMids.length - 1;
    if (mid >= chapterMids[last]) return last;
    for (var i = 0; i < last; i++){
      if (mid < chapterMids[i + 1]){
        return i + (mid - chapterMids[i]) / (chapterMids[i + 1] - chapterMids[i]);
      }
    }
    return last;
  }

  function globeTick(){
    var p = globeProgress();
    globeTarget = -p * STEP;
    globeAngle += (globeTarget - globeAngle) * (reduceMotion ? 1 : 0.12);
    globeRing.style.transform = 'rotate(' + globeAngle.toFixed(2) + 'deg)';

    var idx = Math.round(p);
    if (idx !== currentScene){
      currentScene = idx;
      globeScenes.forEach(function(el, k){ el.classList.toggle('is-current', k === idx); });
    }
    requestAnimationFrame(globeTick);
  }

  measureGlobe();
  window.addEventListener('resize', measureGlobe);
  window.addEventListener('load', function(){ measure(); measureGlobe(); });
  requestAnimationFrame(globeTick);

})();
