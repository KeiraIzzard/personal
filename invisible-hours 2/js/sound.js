/* ============================================================
   THE INVISIBLE HOURS: SOUNDSCAPE
   Every sound is generated live with the Web Audio API, so the
   site needs no audio files.

   Each chapter has its own Australian soundscape (kookaburras,
   magpies, whipbirds, lorikeets, cicadas, a Melbourne station,
   the beach) that crossfades as you scroll. A wooden clock tick
   speeds up as the UV index climbs, the reveal sizzles, and the
   closing falls almost silent.

   All scenes run through a shared outdoor reverb, a gentle EQ and
   a compressor, so they sit together as one polished mix.

   Optional: to swap a scene for a real field recording, put the
   file in an "audio" folder and add it to SAMPLES below, e.g.
     morning: 'audio/morning.mp3'
   ============================================================ */
(function(){
  'use strict';

  var SAMPLES = {
    // morning: 'audio/morning.mp3',
    // commute: 'audio/station.mp3',
    // lunch:   'audio/park.mp3',
    // arvo:    'audio/beach.mp3',
    // evening: 'audio/evening.mp3'
  };

  var AC = window.AudioContext || window.webkitAudioContext;
  var toggle = document.getElementById('soundToggle');
  var heroBtn = document.getElementById('soundStart');
  if (!AC){
    if (toggle) toggle.hidden = true;
    if (heroBtn) heroBtn.hidden = true;
    return;
  }

  /* scene levels, and how much of each scene goes to the reverb */
  var LEVEL  = { hero:0.7, morning:1.6, commute:1.0, lunch:1.7, arvo:1.1, evening:1.6, reveal:0.55, closing:1.2 };
  var REVERB = { morning:0.28, commute:0.5, lunch:0.22, arvo:0.14, evening:0.32, reveal:0.45, closing:0.45 };
  var SCENE_FOR = { hero:'morning', morning:'morning', commute:'commute', lunch:'lunch', arvo:'arvo',
                    evening:'evening', reveal:'reveal', closing:'closing' };
  var TICKING = { morning:1, commute:1, lunch:1, arvo:1, evening:1 };

  var ctx = null, master, mix, reverb, scenes = {}, white, pink, brown, tickBus;
  var enabled = false, chapter = document.body.getAttribute('data-chapter') || 'hero';
  var nextTick = 0, tickAlt = false;

  function rand(a, b){ return a + Math.random() * (b - a); }
  function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

  /* ============================================================
     BUILDING BLOCKS
     ============================================================ */
  function makeNoise(kind){
    var len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0,last=0;
    for (var i = 0; i < len; i++){
      var w = Math.random() * 2 - 1;
      if (kind === 'white'){ d[i] = w; }
      else if (kind === 'pink'){
        b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759; b2=0.96900*b2+w*0.1538520;
        b3=0.86650*b3+w*0.3104856; b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
        d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    // short crossfade at the loop point so looping noise never clicks
    var fade = Math.floor(ctx.sampleRate * 0.05);
    for (var j = 0; j < fade; j++){ var k = j / fade; d[len - fade + j] = d[len - fade + j] * (1 - k) + d[j] * k; }
    return buf;
  }

  /* an outdoor reverb: decaying, darkening stereo noise */
  function makeImpulse(seconds){
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds), ir = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++){
      var d = ir.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++){
        var t = i / len, w = Math.random() * 2 - 1;
        var a = 0.15 + 0.8 * t;               // tail gets darker as it decays
        lp = lp + (w - lp) * (1 - a);
        d[i] = lp * Math.pow(1 - t, 3.2) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
      }
    }
    return ir;
  }

  function g(v){ var n = ctx.createGain(); n.gain.value = v; return n; }
  function f(type, freq, q){ var n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; if (q != null) n.Q.value = q; return n; }
  function pan(v){
    if (ctx.createStereoPanner){ var p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, v)); return p; }
    return g(1);
  }
  function link(){ for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }
  function noise(buf, t){ var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(t || 0, rand(0, 3)); return s; }

  /* place a sound in space: left/right, and distance (0 near, 1 far).
     Far sounds are quieter and lose their top end, like real distance. */
  function place(dest, p, dist){
    dist = dist || 0;
    var lp = f('lowpass', 14000 - dist * 10500, 0.5), v = g(1 / (1 + dist * 2.2)), pn = pan(p);
    link(lp, v, pn, dest);
    return lp;
  }

  /* smooth attack and release with no clicks */
  function env(param, t, peak, attack, hold, release){
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.setValueAtTime(Math.max(peak, 0.0002), t + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  /* a burst of filtered noise with an envelope */
  function burst(t, buf, type, freq, q, peak, attack, hold, release, dest){
    var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    var fl = f(type, freq, q), e = g(0);
    link(s, fl, e, dest);
    env(e.gain, t, peak, attack, hold, release);
    s.start(t, rand(0, 3)); s.stop(t + attack + hold + release + 0.05);
    return { filter: fl, gain: e };
  }

  /* gentle saturation for harsh calls (cockatoos, lorikeets) */
  function shaper(amount){
    var n = 1024, curve = new Float32Array(n);
    for (var i = 0; i < n; i++){ var x = i * 2 / n - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
    var w = ctx.createWaveShaper(); w.curve = curve; w.oversample = '2x'; return w;
  }

  /* ============================================================
     AUSTRALIAN BIRDS
     ============================================================ */

  /* Australian magpie: a rich, flute-like carol that glides between
     notes, with warbles and a throaty gurgle. Often two birds duet. */
  function magpieCarol(t, dest, vol, p, dist, transpose){
    var out = place(dest, p, dist), amp = g(0), body = f('peaking', 1400, 1.2);
    body.gain.value = 4;
    link(amp, body, out);
    var oscs = [1, 2, 3.01].map(function(h, i){
      var o = ctx.createOscillator(), og = g([1, 0.28, 0.07][i]);
      o.type = 'sine'; link(o, og, amp); o.h = h; return o;
    });
    var vib = ctx.createOscillator(), vibAmt = g(22);
    vib.frequency.value = rand(6, 9); link(vib, vibAmt);
    oscs.forEach(function(o){ vibAmt.connect(o.detune); });

    var scale = [523, 587, 659, 784, 880, 988, 1047, 1175, 1319, 1568].map(function(x){ return x * (transpose || 1); });
    var at = t, n = Math.floor(rand(6, 11)), note = pick(scale);
    oscs.forEach(function(o){ o.frequency.setValueAtTime(note * o.h, at); });
    amp.gain.setValueAtTime(0.0001, at);
    for (var i = 0; i < n; i++){
      var dur = rand(0.11, 0.3), next = pick(scale);
      var glide = Math.random() < 0.6;
      oscs.forEach(function(o){
        if (glide) o.frequency.exponentialRampToValueAtTime(next * o.h, at + dur);
        else { o.frequency.setValueAtTime(note * o.h, at); o.frequency.setValueAtTime(next * o.h, at + dur * 0.5); }
      });
      // each syllable swells and dips, legato rather than separate beeps
      amp.gain.exponentialRampToValueAtTime(vol * rand(0.6, 1), at + Math.min(0.04, dur * 0.3));
      amp.gain.exponentialRampToValueAtTime(vol * rand(0.08, 0.3), at + dur);
      // the odd throaty gurgle
      if (Math.random() < 0.18){
        var gur = ctx.createOscillator(), ga = g(0);
        gur.frequency.value = rand(28, 42); link(gur, ga);
        oscs.forEach(function(o){ ga.connect(o.detune); });
        ga.gain.setValueAtTime(0, at); ga.gain.linearRampToValueAtTime(160, at + 0.03); ga.gain.linearRampToValueAtTime(0, at + dur);
        gur.start(at); gur.stop(at + dur + 0.05);
      }
      note = next; at += dur;
      if (Math.random() < 0.15){ amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.05); at += rand(0.1, 0.25); }
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    oscs.concat([vib]).forEach(function(o){ o.start(t); o.stop(at + 0.2); });
    return at;
  }
  function magpieDuet(t, dest, vol){
    var end = magpieCarol(t, dest, vol, rand(-0.6, -0.1), rand(0.1, 0.5), 1);
    if (Math.random() < 0.6) magpieCarol(t + rand(0.3, (end - t) * 0.7), dest, vol * 0.75, rand(0.2, 0.7), rand(0.3, 0.7), pick([0.89, 1.12, 1.19]));
  }

  /* Laughing kookaburra: chuckles that build into "koo-koo-ka-ka-ka"
     and fall away again. A second bird often joins in. */
  function kookaburra(t, dest, vol, p, dist){
    var out = place(dest, p, dist);
    var f1 = f('bandpass', 1150, 2.2), f2 = f('bandpass', 2400, 3), mixg = g(1);
    link(f1, mixg); link(f2, g(0.5), mixg); link(mixg, shaper(1.6), out);
    var n = Math.floor(rand(22, 34)), at = t;
    for (var i = 0; i < n; i++){
      var x = i / n;
      // shape of a laugh: low chuckles, a loud rising middle, a falling tail
      var lift = Math.sin(Math.min(1, x * 1.25) * Math.PI);
      var base = 430 + lift * 640 + rand(-40, 40);
      var hoot = rand(0.06, 0.1), gap = 0.11 - lift * 0.03 + rand(-0.01, 0.015);
      var o = ctx.createOscillator(), e = g(0);
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.86, at);
      o.frequency.exponentialRampToValueAtTime(base * 1.12, at + hoot * 0.35);
      o.frequency.exponentialRampToValueAtTime(base * 0.8, at + hoot);
      link(o, e); e.connect(f1); e.connect(f2);
      env(e.gain, at, vol * (0.25 + lift * 0.75), 0.008, hoot * 0.3, hoot * 0.7);
      o.start(at); o.stop(at + hoot + 0.05);
      // breathy edge
      burst(at, white, 'bandpass', base * 2, 1.5, vol * 0.12 * (0.3 + lift), 0.006, hoot * 0.2, hoot * 0.6, out);
      at += hoot + gap;
    }
    return at;
  }
  function kookaburraChorus(t, dest, vol){
    var p = rand(-0.8, 0.8), dist = rand(0.35, 0.8);
    var end = kookaburra(t, dest, vol, p, dist);
    if (Math.random() < 0.65) kookaburra(t + rand(0.6, (end - t) * 0.5), dest, vol * 0.7, -p * 0.8, Math.min(1, dist + 0.15));
  }

  /* Eastern whipbird: a long rising whistle, a sharp "whip" crack,
     and the partner's quick "chew-chew" answer. */
  function whipbird(t, dest, vol, p, dist){
    var out = place(dest, p, dist);
    var o = ctx.createOscillator(), e = g(0);
    o.type = 'sine'; link(o, e, out);
    var len = rand(0.9, 1.5);
    o.frequency.setValueAtTime(rand(1700, 1900), t);
    o.frequency.linearRampToValueAtTime(rand(2300, 2600), t + len);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(vol * 0.5, t + len * 0.8);
    e.gain.exponentialRampToValueAtTime(vol * 0.35, t + len);
    // the crack: a whip-fast upward sweep
    var c = t + len + 0.03;
    o.frequency.setValueAtTime(1600, c);
    o.frequency.exponentialRampToValueAtTime(7200, c + 0.045);
    e.gain.setValueAtTime(vol, c);
    e.gain.exponentialRampToValueAtTime(0.0001, c + 0.09);
    o.start(t); o.stop(c + 0.12);
    burst(c, white, 'highpass', 5000, 0.7, vol * 0.25, 0.002, 0.01, 0.04, out);
    // the partner's answer
    var a = c + rand(0.12, 0.2), p2 = place(dest, p + 0.3, dist);
    for (var i = 0; i < 2; i++){
      var o2 = ctx.createOscillator(), e2 = g(0); o2.type = 'sine'; link(o2, e2, p2);
      var st = a + i * 0.13;
      o2.frequency.setValueAtTime(2900, st); o2.frequency.exponentialRampToValueAtTime(1700, st + 0.08);
      env(e2.gain, st, vol * 0.45, 0.006, 0.02, 0.06);
      o2.start(st); o2.stop(st + 0.12);
    }
  }

  /* Rainbow lorikeets: bursts of shrill, scratchy screeches from a flock */
  function lorikeets(t, dest, vol, dist){
    var n = Math.floor(rand(5, 14)), at = t;
    for (var i = 0; i < n; i++){
      var out = place(dest, rand(-0.9, 0.9), dist + rand(0, 0.2));
      var bp = f('bandpass', rand(3000, 4200), 2.5), e = g(0), sh = shaper(2.5);
      var o = ctx.createOscillator(); o.type = 'sawtooth';
      var base = rand(2400, 3600), d = rand(0.05, 0.16);
      o.frequency.setValueAtTime(base, at);
      o.frequency.linearRampToValueAtTime(base * rand(0.8, 1.25), at + d);
      var fm = ctx.createOscillator(), fmg = g(rand(250, 600));
      fm.frequency.value = rand(70, 140); link(fm, fmg); fmg.connect(o.frequency);
      link(o, sh, bp, e, out);
      env(e.gain, at, vol * rand(0.5, 1), 0.006, d * 0.4, d * 0.6);
      o.start(at); fm.start(at); o.stop(at + d + 0.05); fm.stop(at + d + 0.05);
      at += rand(0.04, 0.22);
    }
  }

  /* Sulphur-crested cockatoo: a raw, distant screech */
  function cockatoo(t, dest, vol, p, dist){
    var out = place(dest, p, dist);
    var d = rand(0.45, 0.75);
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(620, 760), t);
    o.frequency.linearRampToValueAtTime(rand(820, 960), t + d * 0.3);
    o.frequency.linearRampToValueAtTime(rand(560, 680), t + d);
    var rough = ctx.createOscillator(), rg = g(0.45), am = g(0.55);
    rough.frequency.value = rand(30, 45); link(rough, rg); rg.connect(am.gain);
    var bp = f('bandpass', 1500, 1.1), e = g(0);
    link(o, shaper(4), am, bp, e, out);
    burst(t, white, 'bandpass', 1800, 1.2, vol * 0.3, 0.02, d * 0.5, d * 0.5, out);
    env(e.gain, t, vol, 0.03, d * 0.5, d * 0.5);
    o.start(t); rough.start(t); o.stop(t + d + 0.1); rough.stop(t + d + 0.1);
  }

  /* small native birds (silvereyes, pardalotes): soft, high twitters */
  function twitter(t, dest, vol){
    var out = place(dest, rand(-0.9, 0.9), rand(0.2, 0.7));
    var base = rand(3600, 5200), n = Math.floor(rand(3, 7)), at = t;
    for (var i = 0; i < n; i++){
      var o = ctx.createOscillator(), e = g(0); o.type = 'sine'; link(o, e, out);
      o.frequency.setValueAtTime(base * rand(0.95, 1.05), at);
      o.frequency.exponentialRampToValueAtTime(base * rand(0.8, 1.25), at + 0.06);
      env(e.gain, at, vol * rand(0.5, 1), 0.008, 0.015, 0.05);
      o.start(at); o.stop(at + 0.1);
      at += rand(0.07, 0.14);
    }
  }

  /* Silver gull: a nasal "kee-arr" */
  function gull(t, dest, vol){
    var out = place(dest, rand(-0.8, 0.8), rand(0.2, 0.7));
    var f1 = f('bandpass', 1500, 3), f2 = f('bandpass', 2900, 4), m = g(1);
    link(f1, m); link(f2, g(0.4), m); m.connect(out);
    var n = Math.floor(rand(2, 5)), at = t;
    for (var i = 0; i < n; i++){
      var o = ctx.createOscillator(), e = g(0); o.type = 'sawtooth';
      o.frequency.setValueAtTime(1150, at);
      o.frequency.exponentialRampToValueAtTime(2050, at + 0.07);
      o.frequency.exponentialRampToValueAtTime(980, at + 0.36);
      link(o, e); e.connect(f1); e.connect(f2);
      env(e.gain, at, vol, 0.03, 0.08, 0.28);
      o.start(at); o.stop(at + 0.45);
      at += rand(0.42, 0.62);
    }
  }

  /* ============================================================
     CITY, BEACH AND NIGHT SOUNDS
     ============================================================ */

  /* a car passing, with a doppler pitch drop and tyre roar */
  function carPass(t, dest, vol, dist){
    var dur = rand(3.8, 5.5), dir = Math.random() < 0.5 ? -1 : 1, mid = t + dur * 0.5;
    var pn = pan(-0.85 * dir), lp = f('lowpass', 2400 - (dist || 0) * 1400, 0.5), e = g(0);
    link(e, lp, pn, dest);
    if (pn.pan){ pn.pan.setValueAtTime(-0.85 * dir, t); pn.pan.linearRampToValueAtTime(0.85 * dir, t + dur); }
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(vol, mid);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var n1 = noise(brown, t), n2 = noise(pink, t);
    link(n1, f('lowpass', 500, 0.6), e);
    link(n2, f('bandpass', 900, 0.7), g(0.3), e);
    n1.stop(t + dur + 0.1); n2.stop(t + dur + 0.1);
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    var hz = rand(85, 105);
    o.frequency.setValueAtTime(hz * 1.08, t);
    o.frequency.setValueAtTime(hz * 1.08, mid - 0.25);
    o.frequency.exponentialRampToValueAtTime(hz * 0.9, mid + 0.25);
    link(o, f('lowpass', 220, 0.8), g(0.25), e);
    o.start(t); o.stop(t + dur + 0.1);
  }

  /* a Melbourne train pulling through: rumble, motor whine, wheel clacks */
  function trainPass(t, dest, vol){
    var rise = 3.2, hold = 3.6, fall = 3.8, total = rise + hold + fall, dir = Math.random() < 0.5 ? -1 : 1;
    var pn = pan(-0.7 * dir), e = g(0); link(e, pn, dest);
    if (pn.pan){ pn.pan.setValueAtTime(-0.7 * dir, t); pn.pan.linearRampToValueAtTime(0.7 * dir, t + total); }
    env(e.gain, t, vol, rise, hold, fall);
    var n1 = noise(brown, t), n2 = noise(white, t);
    link(n1, f('lowpass', 200, 0.7), g(0.6), e);
    link(n2, f('bandpass', 3200, 5), g(0.05), e);
    n1.stop(t + total + 0.1); n2.stop(t + total + 0.1);
    var m = ctx.createOscillator(); m.type = 'triangle';
    m.frequency.setValueAtTime(rand(520, 600), t);
    m.frequency.linearRampToValueAtTime(rand(380, 440), t + total);
    link(m, g(0.05), e); m.start(t); m.stop(t + total + 0.1);
    for (var c = 0.8; c < total - 0.6; c += 0.64){
      var lvl = c < rise ? c / rise : (c < rise + hold ? 1 : Math.max(0, 1 - (c - rise - hold) / fall));
      if (lvl < 0.1) continue;
      clack(t + c, dest, vol * 0.45 * lvl, pn);
      clack(t + c + 0.13, dest, vol * 0.38 * lvl, pn);
    }
  }
  function clack(t, dest, vol, via){
    var o = via || dest;
    burst(t, white, 'bandpass', 1250, 1.8, vol, 0.002, 0.008, 0.06, o);
    var thump = ctx.createOscillator(), e = g(0); thump.frequency.setValueAtTime(110, t);
    thump.frequency.exponentialRampToValueAtTime(55, t + 0.08);
    link(thump, e, o); env(e.gain, t, vol * 0.7, 0.003, 0.01, 0.07);
    thump.start(t); thump.stop(t + 0.12);
  }
  /* station PA chime: two bell tones with natural, inharmonic partials */
  function stationChime(t, dest){
    var out = place(dest, 0.25, 0.25);
    [[659.3, 0], [523.3, 0.6]].forEach(function(nt){
      [[1, 0.06], [2.0, 0.02], [2.76, 0.012], [5.4, 0.004]].forEach(function(pt){
        var o = ctx.createOscillator(), e = g(0); o.type = 'sine';
        o.frequency.value = nt[0] * pt[0]; link(o, e, out);
        env(e.gain, t + nt[1], pt[1], 0.005, 0.02, 1.6 / pt[0] + 0.4);
        o.start(t + nt[1]); o.stop(t + nt[1] + 2.4);
      });
    });
  }
  /* footsteps on concrete */
  function footsteps(t, dest, vol){
    var out = place(dest, rand(-0.8, 0.8), rand(0.1, 0.6));
    var n = Math.floor(rand(4, 9)), gap = rand(0.45, 0.56);
    for (var i = 0; i < n; i++){
      burst(t + i * gap, white, 'bandpass', rand(900, 1300), 1.4, vol * rand(0.7, 1), 0.002, 0.008, 0.05, out);
      burst(t + i * gap, brown, 'lowpass', 180, 0.8, vol * 1.4, 0.002, 0.01, 0.06, out);
    }
  }
  /* a wave building, breaking and washing up the sand */
  function wave(t, dest, vol){
    var rise = rand(1.6, 2.4), fall = rand(3.5, 5), out = place(dest, rand(-0.5, 0.5), 0.1);
    var b = burst(t, pink, 'lowpass', 400, 0.5, vol, rise, 0.25, fall, out);
    b.filter.frequency.setValueAtTime(320, t);
    b.filter.frequency.exponentialRampToValueAtTime(2400, t + rise + 0.2);
    b.filter.frequency.exponentialRampToValueAtTime(450, t + rise + fall);
    burst(t + rise, white, 'highpass', 3500, 0.6, vol * 0.18, 0.2, 0.3, fall * 0.8, out);
    burst(t + rise + 0.1, brown, 'lowpass', 160, 0.7, vol * 0.6, 0.05, 0.1, 1.2, out);
  }
  /* field crickets */
  function cricket(t, out, vol, hz){
    for (var i = 0; i < 3; i++){
      var o = ctx.createOscillator(), e = g(0); o.type = 'sine'; o.frequency.value = hz; link(o, e, out);
      env(e.gain, t + i * 0.055, vol, 0.004, 0.018, 0.015);
      o.start(t + i * 0.055); o.stop(t + i * 0.055 + 0.05);
    }
  }
  /* sizzle crackle: pops and spits, like fat in a hot pan */
  function crackle(t, dest, vol){
    var out = place(dest, rand(-0.6, 0.6), 0);
    if (Math.random() < 0.85){
      burst(t, white, 'bandpass', rand(3000, 8000), rand(1.5, 4), vol * rand(0.3, 1), 0.0008, rand(0.001, 0.004), rand(0.006, 0.02), out);
    } else {
      burst(t, white, 'bandpass', rand(1200, 2400), 1.2, vol * rand(0.6, 1.2), 0.001, 0.01, rand(0.03, 0.07), out);
    }
  }

  /* ============================================================
     SCENES: a continuous bed plus scheduled events
     ============================================================ */
  function makeScene(name, build){
    var out = g(0), synth = g(1), send = g(REVERB[name] || 0.25);
    synth.connect(out); out.connect(mix); out.connect(send); send.connect(reverb);
    var s = { name: name, out: out, synth: synth, events: [], active: false };
    build(s);
    if (SAMPLES[name]) loadSample(s, SAMPLES[name]);
    scenes[name] = s;
  }
  function bed(s, buf, type, freq, q, vol, p){
    link(noise(buf), f(type, freq, q), g(vol), pan(p || 0), s.synth);
  }
  function breeze(s, lo, hi, every){
    var e = g(lo), fl = f('bandpass', 1200, 0.4);
    link(noise(pink), fl, e, s.synth);
    s.events.push({ every: every, fn: function(t){
      e.gain.setTargetAtTime(rand(lo, hi), t, rand(1.2, 2.5));
      fl.frequency.setTargetAtTime(rand(700, 2400), t, 2);
    }});
  }
  function every(s, range, fn){ s.events.push({ every: range, fn: fn }); }

  function buildScenes(){
    /* 7:12 AM: a suburban street waking up.
       Kookaburras laughing, a magpie carol, small birds, the odd car. */
    makeScene('morning', function(s){
      bed(s, brown, 'lowpass', 260, 0.5, 0.025);
      breeze(s, 0.006, 0.02, [2, 4]);
      every(s, [5, 9], function(t){ magpieDuet(t, s.synth, 0.05); });
      every(s, [14, 24], function(t){ kookaburraChorus(t, s.synth, 0.05); });
      every(s, [2, 5], function(t){ twitter(t, s.synth, 0.018); });
      every(s, [7, 13], function(t){ carPass(t, s.synth, 0.13, rand(0.2, 0.7)); });
    });

    /* 8:40 AM: the station. Crowd murmur, footsteps, trains, the PA chime. */
    makeScene('commute', function(s){
      bed(s, brown, 'lowpass', 240, 0.5, 0.05);
      // crowd murmur: "voices" of filtered noise with two speech-like formants
      var crowd = g(1); link(crowd, f('lowpass', 2600, 0.5), s.synth);
      for (var v = 0; v < 7; v++){
        (function(){
          var src = noise(pink), f1 = f('bandpass', rand(400, 800), 4), f2 = f('bandpass', rand(1100, 1900), 5);
          var vg = g(0), vp = pan(rand(-0.8, 0.8));
          src.connect(f1); src.connect(f2); f1.connect(vg); link(f2, g(0.6), vg); link(vg, vp, crowd);
          every(s, [0.12, 0.3], function(t){
            vg.gain.setTargetAtTime(Math.random() < 0.3 ? 0 : rand(0.025, 0.06), t, 0.05);
            f1.frequency.setTargetAtTime(rand(380, 850), t, 0.07);
            f2.frequency.setTargetAtTime(rand(1000, 2000), t, 0.07);
          });
        })();
      }
      every(s, [2.5, 5], function(t){ footsteps(t, s.synth, 0.035); });
      every(s, [11, 16], function(t){ trainPass(t, s.synth, 0.42); });
      every(s, [17, 26], function(t){ stationChime(t, s.synth); });
      every(s, [9, 18], function(t){ magpieCarol(t, s.synth, 0.02, rand(-0.8, 0.8), 0.8, 1); });
    });

    /* 12:30 PM: the park at midday. Cicadas, a whipbird, lorikeets,
       a distant cockatoo and leaves moving in the breeze. */
    makeScene('lunch', function(s){
      [[4500, -0.6, 47], [5100, 0.1, 52], [5800, 0.6, 44]].forEach(function(c){
        var src = noise(white), bp = f('bandpass', c[0], 10), amp = g(0.5), swell = g(0.03), p = pan(c[1]);
        var lfo = ctx.createOscillator(), depth = g(0.5);
        lfo.type = 'sine'; lfo.frequency.value = c[2];
        link(lfo, depth); depth.connect(amp.gain); lfo.start();
        link(src, bp, amp, swell, f('lowpass', 8000, 0.5), p, s.synth);
        every(s, [5, 10], function(t){ swell.gain.setTargetAtTime(rand(0.02, 0.12), t, rand(1.5, 3)); });
      });
      breeze(s, 0.01, 0.045, [1.5, 3.5]);
      every(s, [9, 16], function(t){ whipbird(t, s.synth, 0.045, rand(-0.7, 0.7), rand(0.3, 0.7)); });
      every(s, [7, 13], function(t){ lorikeets(t, s.synth, 0.02, rand(0.3, 0.6)); });
      every(s, [15, 28], function(t){ cockatoo(t, s.synth, 0.04, rand(-0.9, 0.9), rand(0.6, 0.9)); });
      every(s, [8, 14], function(t){ magpieCarol(t, s.synth, 0.025, rand(-0.8, 0.8), 0.5, 1); });
    });

    /* 2:15 PM: the beach. Waves, silver gulls, wind. */
    makeScene('arvo', function(s){
      bed(s, brown, 'lowpass', 420, 0.5, 0.07);
      breeze(s, 0.01, 0.04, [2, 4]);
      every(s, [4.5, 7.5], function(t){ wave(t, s.synth, 0.3); });
      every(s, [5, 12], function(t){ gull(t, s.synth, 0.03); });
    });

    /* 6:45 PM: home at dusk. Crickets, lorikeets settling in to roost,
       a far-off kookaburra, a distant car. */
    makeScene('evening', function(s){
      bed(s, brown, 'lowpass', 220, 0.5, 0.02);
      breeze(s, 0.004, 0.012, [3, 6]);
      var c1 = place(s.synth, -0.6, 0.3), c2 = place(s.synth, 0.55, 0.5);
      every(s, [0.55, 0.9], function(t){ cricket(t, c1, 0.016, 4400); });
      every(s, [0.75, 1.3], function(t){ cricket(t, c2, 0.011, 4650); });
      every(s, [6, 11], function(t){ lorikeets(t, s.synth, 0.014, 0.6); });
      every(s, [22, 36], function(t){ kookaburra(t, s.synth, 0.03, rand(-0.9, 0.9), 0.9); });
      every(s, [11, 18], function(t){ carPass(t, s.synth, 0.06, 0.8); });
    });

    /* Tonight: the reveal. A frying hiss and crackle over a low, uneasy drone. */
    makeScene('reveal', function(s){
      var hiss = g(0.035); link(noise(white), f('bandpass', 5500, 0.5), hiss, s.synth);
      every(s, [0.8, 2], function(t){ hiss.gain.setTargetAtTime(rand(0.02, 0.06), t, 0.6); });
      every(s, [0.02, 0.08], function(t){ crackle(t, s.synth, 0.11); });
      var drone = g(1); link(drone, f('lowpass', 300, 0.7), s.synth);
      [[55, 0.03], [55.35, 0.025], [110.2, 0.012]].forEach(function(d){
        var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = d[0];
        link(o, g(d[1]), drone); o.start();
      });
    });

    /* Tomorrow: near silence. One distant magpie: the next ordinary day. */
    makeScene('closing', function(s){
      breeze(s, 0.004, 0.01, [3, 6]);
      every(s, [8, 14], function(t){ magpieCarol(t, s.synth, 0.025, rand(-0.6, 0.6), 0.7, 1); });
    });
  }

  /* optional real recordings */
  function loadSample(s, url){
    fetch(url).then(function(r){ if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(function(ab){ return new Promise(function(res, rej){ ctx.decodeAudioData(ab, res, rej); }); })
      .then(function(buf){
        var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        src.connect(s.out); src.start();
        s.synth.gain.setTargetAtTime(0, ctx.currentTime, 0.3);   // the recording replaces the generated sound
        s.events = [];
      })
      .catch(function(){ /* file missing: keep the generated sound */ });
  }

  /* ============================================================
     TICKING: a wooden clock that speeds up and gets louder
     as the UV index climbs
     ============================================================ */
  function tickSound(t, uv){
    var vol = 0.05 + (uv / 12) * 0.08;
    var tock = tickAlt; tickAlt = !tickAlt;
    burst(t, white, 'bandpass', tock ? 2600 : 3300, 5, vol, 0.0008, 0.002, 0.012, tickBus);
    var o = ctx.createOscillator(), e = g(0); o.type = 'sine';
    o.frequency.setValueAtTime(tock ? 900 : 1150, t);
    o.frequency.exponentialRampToValueAtTime(tock ? 760 : 980, t + 0.03);
    link(o, e, tickBus); env(e.gain, t, vol * 0.5, 0.001, 0.004, 0.03);
    o.start(t); o.stop(t + 0.05);
  }
  function tickInterval(uv){
    // UV 1 ≈ one tick a second, UV 11 ≈ more than three a second
    return Math.max(0.24, 1.1 - (uv / 12) * 0.85);
  }

  /* ============================================================
     SCHEDULER: looks a little ahead and places events on the
     audio clock, so timing stays tight even if the page is busy
     ============================================================ */
  function schedule(){
    if (!ctx || ctx.state !== 'running') return;
    var now = ctx.currentTime, ahead = now + 0.25;
    Object.keys(scenes).forEach(function(k){
      var s = scenes[k];
      if (!s.active) return;
      s.events.forEach(function(ev){
        if (ev.next == null || ev.next < now - 1) ev.next = now + rand(0, ev.every[0]);
        while (ev.next < ahead){
          ev.fn(Math.max(ev.next, now + 0.01));
          ev.next += rand(ev.every[0], ev.every[1]);
        }
      });
    });
    if (TICKING[chapter]){
      var uv = (window.IH && typeof window.IH.uv === 'number') ? window.IH.uv : 0;
      if (nextTick < now) nextTick = now + 0.05;
      while (nextTick < ahead){ tickSound(nextTick, uv); nextTick += tickInterval(uv); }
    } else {
      nextTick = 0;
    }
  }

  /* ---------- crossfade between scenes ---------- */
  function setChapter(ch){
    var prev = chapter;
    chapter = ch;
    if (!ctx) return;
    var target = SCENE_FOR[ch] || 'morning', now = ctx.currentTime;
    Object.keys(scenes).forEach(function(k){
      var s = scenes[k], on = (k === target);
      var fadeIn = (k === 'reveal') ? 0.25 : 0.8;
      var fadeOut = (prev === 'reveal' || target === 'reveal') ? 0.35 : 0.9;
      if (on){ s.active = true; s.out.gain.setTargetAtTime(LEVEL[ch] || 0.8, now, fadeIn); }
      else if (s.active){
        s.out.gain.setTargetAtTime(0, now, fadeOut);
        (function(s){ setTimeout(function(){ if (SCENE_FOR[chapter] !== s.name){ s.active = false; s.events.forEach(function(e){ e.next = null; }); } }, 4500); })(s);
      }
    });
    // the moment the page turns to the reveal: the tick stops dead and the skin "sears"
    if (target === 'reveal' && prev !== 'reveal'){
      burst(now + 0.05, white, 'bandpass', 4500, 0.6, 0.3, 0.5, 0.4, 2.4, scenes.reveal.synth);
      for (var i = 0; i < 45; i++) crackle(now + 0.05 + Math.random() * 1.8, scenes.reveal.synth, 0.18);
    }
  }

  /* ---------- start / stop ---------- */
  function init(){
    ctx = new AC();
    white = makeNoise('white'); pink = makeNoise('pink'); brown = makeNoise('brown');

    // mix bus → gentle EQ → compressor → master volume
    mix = g(1);
    reverb = ctx.createConvolver(); reverb.buffer = makeImpulse(2.4);
    var wet = g(0.55); link(reverb, f('highpass', 180, 0.5), wet, mix);
    var lowCut = f('highpass', 35, 0.7);
    var warmth = f('lowshelf', 180, null); warmth.gain.value = 1.5;
    var soften = f('highshelf', 7500, null); soften.gain.value = -3;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3;
    comp.attack.value = 0.01; comp.release.value = 0.25;
    master = g(0);
    link(mix, lowCut, warmth, soften, comp, master, ctx.destination);

    tickBus = g(1); tickBus.connect(mix); link(tickBus, g(0.15), reverb);
    buildScenes();
    window.IH = window.IH || {};
    window.IH.audio = { ctx: ctx, master: master };
    setInterval(schedule, 60);
  }

  function setEnabled(on){
    enabled = on;
    if (on){
      if (!ctx) init();
      ctx.resume();
      setChapter(document.body.getAttribute('data-chapter') || 'hero');
      master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.5);
    } else if (ctx){
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(function(){ if (!enabled) ctx.suspend(); }, 700);
    }
    [toggle, heroBtn].forEach(function(b){ if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (toggle) toggle.querySelector('.sound-label').textContent = on ? 'Sound on' : 'Sound off';
    document.body.classList.toggle('sound-on', on);
  }

  if (toggle) toggle.addEventListener('click', function(){ setEnabled(!enabled); });
  if (heroBtn) heroBtn.addEventListener('click', function(){ setEnabled(true); });

  // follow the chapter that script.js sets on <body>
  new MutationObserver(function(){
    var ch = document.body.getAttribute('data-chapter');
    if (ch !== chapter) setChapter(ch);
  }).observe(document.body, { attributes: true, attributeFilter: ['data-chapter'] });

  // pause when the tab is hidden, resume when it comes back
  document.addEventListener('visibilitychange', function(){
    if (!ctx || !enabled) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });
})();
