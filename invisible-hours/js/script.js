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
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  var chapterSections = document.querySelectorAll('[data-chapter]');
  var captions = {
    hero: '—',
    morning: 'Barely worth mentioning',
    commute: 'Already past the safe window',
    lunch: 'Peak sun, zero symptoms',
    arvo: "Today's high",
    evening: "Today's total",
    reveal: 'Invisible ≠ harmless',
    closing: 'Every day, not just the hot ones'
  };

  var chapterObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting && entry.intersectionRatio > 0.5){
        var ch = entry.target.getAttribute('data-chapter');
        body.setAttribute('data-chapter', ch);
        var uvAttr = entry.target.getAttribute('data-uv');
        if (uvAttr !== null) targetUV = parseFloat(uvAttr);
        gaugeCaption.textContent = captions[ch] || '—';
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
    var arcHeight = vh * 0.52;
    var y = (vh * 0.72) - Math.sin(arcT * Math.PI) * arcHeight;

    var scale = 0.7 + Math.sin(arcT * Math.PI) * 0.55;
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

})();
