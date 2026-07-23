(() => {
  'use strict';

  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const MAX_DPR = 2;
  const MAX_DT = 0.05;
  const FRAME_INTERVAL = 1000 / 30;

  const byId = (id) => document.getElementById(id);
  const canvas = byId('rotorCanvas');
  const ctx = canvas && canvas.getContext('2d', { alpha: false });
  if (!canvas || !ctx) return;

  const VZ = vec(0, 0, 1);
  const VY = vec(0, 1, 0);
  const LIGHT = normalize(vec(-0.42, -0.58, 0.72));

  const C = Object.freeze({
    edge: '#071017',
    static: '#4d7890',
    staticLight: '#89abb9',
    staticDark: '#1d384a',
    metal: '#a4bbc4',
    darkMetal: '#334b59',
    rotating: '#dc7e36',
    rotatingDark: '#8d461f',
    control: '#28cad5',
    controlLight: '#9cf0f2',
    power: '#efb64c',
    powerDark: '#9e6828',
    blade: '#455f70',
    bladeTip: '#7690a0',
    gearcase: '#476c7e',
    joint: '#d2e2e6'
  });

  const DIM = Object.freeze({
    zNeutral: 244,
    hubZ: 385,
    servoAnchorR: 112,
    servoMountR: 214,
    nonrotOuterR: 126,
    nonrotInnerR: 97,
    rotOuterR: 92,
    rotInnerR: 67,
    rotorAttachR: 78,
    rotorLinkNormalOffset: 21,
    pitchHornBaseR: 117,
    pitchHornLength: 134,
    scissorArmLength: 86,
    bladeRootR: 132,
    bladeLength: 466
  });
  const PITCH_REFERENCE_ANGLE = (2 + 12 * 0.35) * DEG;
  const PITCH_LINK_LENGTH = Math.hypot(
    DIM.pitchHornBaseR - DIM.rotorAttachR,
    DIM.pitchHornLength * Math.cos(PITCH_REFERENCE_ANGLE),
    DIM.hubZ + DIM.pitchHornLength * Math.sin(PITCH_REFERENCE_ANGLE)
      - (DIM.zNeutral + 28 * 0.35 + DIM.rotorLinkNormalOffset)
  );

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    power: 0.65,
    collective: 0.35,
    lateral: 0,
    longitudinal: 0,
    phase: 0.48,
    rpm: reducedMotion.matches ? 0 : 234,
    running: !reducedMotion.matches,
    activeView: 'system',
    showLabels: true,
    caseXray: true
  };

  const ui = {
    powerRange: byId('powerRange'),
    collectiveRange: byId('collectiveRange'),
    lateralRange: byId('lateralRange'),
    longitudinalRange: byId('longitudinalRange'),
    powerValue: byId('powerValue'),
    collectiveValue: byId('collectiveValue'),
    lateralValue: byId('lateralValue'),
    longitudinalValue: byId('longitudinalValue'),
    cyclicValue: byId('cyclicValue'),
    cyclicPad: byId('cyclicPad'),
    padMarker: byId('padMarker'),
    runButton: byId('runButton'),
    resetButton: byId('resetButton'),
    statusDot: byId('statusDot'),
    systemStatus: byId('systemStatus'),
    headerRpm: byId('headerRpm'),
    rpmValue: byId('rpmValue'),
    swashValue: byId('swashValue'),
    tiltValue: byId('tiltValue'),
    servoBars: [byId('servoBar0'), byId('servoBar1'), byId('servoBar2')],
    servoValues: [byId('servoValue0'), byId('servoValue1'), byId('servoValue2')],
    bladeValues: [byId('bladeValue0'), byId('bladeValue1'), byId('bladeValue2'), byId('bladeValue3')],
    viewButtons: Array.from(document.querySelectorAll('[data-view]')),
    labelsToggle: byId('labelsToggle'),
    caseToggle: byId('caseToggle')
  };

  const views = {
    system: { yaw: -2.27, pitch: 0.51, distance: 1125, target: vec(-8, 0, 235) },
    rotor: { yaw: -2.16, pitch: 0.42, distance: 735, target: vec(0, 0, 310) },
    transmission: { yaw: -2.55, pitch: 0.34, distance: 660, target: vec(-55, 0, 105) }
  };

  const camera = {
    yaw: views.system.yaw,
    pitch: views.system.pitch,
    distance: views.system.distance,
    target: clone(views.system.target)
  };

  let viewport = { width: 1, height: 1, dpr: 1 };
  let raf = 0;
  let lastFrame = 0;
  let lastTelemetry = -Infinity;
  let dragCamera = null;
  let dragPad = null;
  let faces = [];
  let labels = [];

  function vec(x, y, z) {
    return { x, y, z };
  }

  function clone(a) {
    return vec(a.x, a.y, a.z);
  }

  function add(a, b) {
    return vec(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  function sub(a, b) {
    return vec(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function scale(a, n) {
    return vec(a.x * n, a.y * n, a.z * n);
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cross(a, b) {
    return vec(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x
    );
  }

  function magnitude(a) {
    return Math.hypot(a.x, a.y, a.z);
  }

  function normalize(a) {
    const m = magnitude(a) || 1;
    return vec(a.x / m, a.y / m, a.z / m);
  }

  function midpoint(a, b) {
    return scale(add(a, b), 0.5);
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function formatSigned(value, decimals) {
    const rounded = Number(value.toFixed(decimals));
    return (rounded >= 0 ? '+' : '') + rounded.toFixed(decimals);
  }

  function distanceSquared(a, b) {
    return dot(sub(a, b), sub(a, b));
  }

  function pitchHornTip(psi, pitchDegrees) {
    const radial = vec(Math.cos(psi), Math.sin(psi), 0);
    const tangent = vec(-Math.sin(psi), Math.cos(psi), 0);
    const pitchRadians = pitchDegrees * DEG;
    const chord = add(scale(tangent, Math.cos(pitchRadians)), scale(VZ, Math.sin(pitchRadians)));
    const hornBase = add(vec(0, 0, DIM.hubZ), scale(radial, DIM.pitchHornBaseR));
    return add(hornBase, scale(chord, DIM.pitchHornLength));
  }

  function pitchLinkDistanceSquared(k, psi, pitchDegrees) {
    const linkStart = ringPoint(k, DIM.rotorAttachR, psi, DIM.rotorLinkNormalOffset);
    return distanceSquared(linkStart, pitchHornTip(psi, pitchDegrees));
  }

  function solvePitchAngle(k, psi, commandedPitch) {
    const command = clamp(Number.isFinite(commandedPitch) ? commandedPitch : 0, -55, 55);
    const targetLengthSquared = PITCH_LINK_LENGTH * PITCH_LINK_LENGTH;
    const constraint = (pitch) => {
      const value = pitchLinkDistanceSquared(k, psi, pitch) - targetLengthSquared;
      return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    };
    const candidates = [];
    let closest = command;
    let closestError = Math.abs(constraint(command));
    let previousAngle = -55;
    let previousValue = constraint(previousAngle);

    for (let angle = -54.5; angle <= 55; angle += 0.5) {
      const value = constraint(angle);
      if (Math.abs(value) < closestError) {
        closest = angle;
        closestError = Math.abs(value);
      }
      if (Number.isFinite(previousValue) && Number.isFinite(value)) {
        if (Math.abs(previousValue) < 1e-12) {
          candidates.push(previousAngle);
        } else if (previousValue * value < 0) {
          let low = previousAngle;
          let high = angle;
          let lowValue = previousValue;
          for (let iteration = 0; iteration < 42; iteration += 1) {
            const middle = (low + high) * 0.5;
            const middleValue = constraint(middle);
            if (Math.abs(middleValue) < 1e-13) {
              low = middle;
              high = middle;
              break;
            }
            if (lowValue * middleValue <= 0) {
              high = middle;
            } else {
              low = middle;
              lowValue = middleValue;
            }
          }
          candidates.push((low + high) * 0.5);
        }
      }
      previousAngle = angle;
      previousValue = value;
    }

    if (candidates.length) {
      return candidates.reduce((nearest, candidate) => (
        Math.abs(candidate - command) < Math.abs(nearest - command) ? candidate : nearest
      ), candidates[0]);
    }
    return clamp(closest, -55, 55);
  }

  function calculateKinematics() {
    const c = clamp(state.collective, 0, 1);
    const lateral = clamp(state.lateral, -1, 1);
    const longitudinal = clamp(state.longitudinal, -1, 1);
    const zCenter = DIM.zNeutral + 28 * c;
    const slopeX = Math.tan(8 * DEG) * lateral;
    const slopeY = Math.tan(8 * DEG) * longitudinal;
    const normal = normalize(vec(-slopeX, -slopeY, 1));
    const thetaCollective = 2 + 12 * c;
    const planeZ = (x, y) => zCenter + slopeX * x + slopeY * y;
    const plate = { zCenter, slopeX, slopeY, normal, planeZ };
    const servoAngles = [0, 120 * DEG, 240 * DEG];
    const servos = servoAngles.map((angle, index) => {
      const x = DIM.servoAnchorR * Math.cos(angle);
      const y = DIM.servoAnchorR * Math.sin(angle);
      const z = planeZ(x, y);
      return {
        index,
        angle,
        anchor: vec(x, y, z),
        stroke: z - DIM.zNeutral
      };
    });
    const blades = Array.from({ length: 4 }, (_, index) => {
      const psi = state.phase + index * Math.PI / 2;
      const pitchCommand = thetaCollective
        + 5 * lateral * Math.cos(psi)
        + 5 * longitudinal * Math.sin(psi);
      const pitch = solvePitchAngle(plate, psi, pitchCommand);
      return {
        index,
        psi,
        pitchCommand,
        pitch,
        linkLength: Math.sqrt(pitchLinkDistanceSquared(plate, psi, pitch))
      };
    });

    return {
      c,
      lateral,
      longitudinal,
      zCenter,
      slopeX,
      slopeY,
      normal,
      planeZ,
      thetaCollective,
      servos,
      blades,
      tilt: Math.atan(Math.hypot(slopeX, slopeY)) / DEG
    };
  }

  function updateCommandReadouts() {
    ui.powerRange.value = String(Math.round(state.power * 100));
    ui.collectiveRange.value = String(Math.round(state.collective * 100));
    ui.lateralRange.value = String(Math.round(state.lateral * 100));
    ui.longitudinalRange.value = String(Math.round(state.longitudinal * 100));
    ui.powerValue.textContent = Math.round(state.power * 100) + '%';
    ui.collectiveValue.textContent = Math.round(state.collective * 100) + '%';
    ui.lateralValue.textContent = formatSigned(state.lateral, 2);
    ui.longitudinalValue.textContent = formatSigned(state.longitudinal, 2);
    ui.cyclicValue.textContent = 'LAT ' + formatSigned(state.lateral, 2)
      + ' / LON ' + formatSigned(state.longitudinal, 2);
    ui.padMarker.style.left = (50 + state.lateral * 35) + '%';
    ui.padMarker.style.top = (50 - state.longitudinal * 35) + '%';
  }

  function updateSystemStatus() {
    const targetRpm = state.running ? 360 * state.power : 0;
    const stopped = targetRpm <= 0 && state.rpm < 0.15;
    const coasting = !stopped && targetRpm <= 0;
    const status = stopped ? 'ROTOR STOPPED' : (coasting ? 'COASTING DOWN' : 'ROTOR ONLINE');
    if (ui.systemStatus.textContent !== status) ui.systemStatus.textContent = status;
    ui.statusDot.classList.toggle('is-idle', targetRpm <= 0);
    ui.runButton.textContent = state.running ? 'STOP ROTOR' : 'START ROTOR';
    ui.runButton.setAttribute('aria-pressed', state.running ? 'true' : 'false');
  }

  function updateDisplayToggles() {
    const toggles = [
      [ui.labelsToggle, state.showLabels],
      [ui.caseToggle, state.caseXray]
    ];
    toggles.forEach(([button, active]) => {
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateTelemetry(force) {
    const now = performance.now();
    if (!force && now - lastTelemetry < 100) return;
    lastTelemetry = now;
    const k = calculateKinematics();
    const rpm = Math.max(0, state.rpm);
    ui.headerRpm.textContent = Math.round(rpm) + ' RPM';
    ui.rpmValue.innerHTML = Math.round(rpm) + ' <small>RPM</small>';
    ui.swashValue.innerHTML = formatSigned(k.zCenter - DIM.zNeutral, 1) + ' <small>mm</small>';
    ui.tiltValue.innerHTML = k.tilt.toFixed(1) + '<small>°</small>';
    k.servos.forEach((servo, index) => {
      ui.servoValues[index].textContent = formatSigned(servo.stroke, 1) + ' mm';
      const normalized = clamp(servo.stroke / 38, -1, 1);
      const width = Math.max(2, Math.abs(normalized) * 50);
      ui.servoBars[index].style.marginLeft = (normalized < 0 ? 50 + normalized * 50 : 50) + '%';
      ui.servoBars[index].style.width = width + '%';
    });
    k.blades.forEach((blade, index) => {
      ui.bladeValues[index].textContent = 'B' + (index + 1) + ' ' + formatSigned(blade.pitch, 1) + '°';
    });
    updateSystemStatus();
  }

  function setCyclic(lateral, longitudinal) {
    state.lateral = clamp(lateral, -1, 1);
    state.longitudinal = clamp(longitudinal, -1, 1);
    updateCommandReadouts();
    updateTelemetry(false);
    renderScene();
  }

  function setCameraPreset(name) {
    const view = views[name];
    if (!view) return;
    camera.yaw = view.yaw;
    camera.pitch = view.pitch;
    camera.distance = view.distance;
    camera.target = clone(view.target);
    state.activeView = name;
    ui.viewButtons.forEach((button) => {
      const active = button.dataset.view === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    renderScene();
  }

  function clearCameraPreset() {
    if (!state.activeView) return;
    state.activeView = '';
    ui.viewButtons.forEach((button) => {
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
    });
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    viewport = { width, height, dpr };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderScene();
  }

  function makeView() {
    const horizontal = Math.cos(camera.pitch);
    const cameraPosition = add(camera.target, vec(
      Math.cos(camera.yaw) * horizontal * camera.distance,
      Math.sin(camera.yaw) * horizontal * camera.distance,
      Math.sin(camera.pitch) * camera.distance
    ));
    const forward = normalize(sub(camera.target, cameraPosition));
    const right = normalize(cross(forward, VZ));
    const up = normalize(cross(right, forward));
    return {
      position: cameraPosition,
      forward,
      right,
      up,
      focal: Math.min(viewport.width, viewport.height) * 0.92
    };
  }

  function project(point, view) {
    const relative = sub(point, view.position);
    const depth = dot(relative, view.forward);
    if (depth <= 3) return null;
    return {
      x: viewport.width * 0.5 + dot(relative, view.right) * view.focal / depth,
      y: viewport.height * 0.54 - dot(relative, view.up) * view.focal / depth,
      depth
    };
  }

  function pushFace(vertices, color, options) {
    if (!vertices || vertices.length < 3) return;
    const opts = options || {};
    const normal = opts.normal || normalize(cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0])));
    faces.push({
      vertices,
      color,
      normal,
      opacity: opts.opacity === undefined ? 1 : opts.opacity,
      stroke: opts.stroke || C.edge,
      lineWidth: opts.lineWidth === undefined ? 0.7 : opts.lineWidth
    });
  }

  function addLabel(point, text, color) {
    labels.push({ point, text, color: color || '#c6edf0' });
  }

  function basisFromAxis(axis) {
    const n = normalize(axis);
    const helper = Math.abs(n.z) < 0.9 ? VZ : VY;
    const u = normalize(cross(helper, n));
    const w = normalize(cross(n, u));
    return { u, w, n };
  }

  function localPoint(center, basis, x, y, z) {
    return add(center, add(scale(basis.u, x), add(scale(basis.w, y), scale(basis.n, z))));
  }

  function addCylinder(center, axis, radius, length, color, segments, options) {
    const count = segments || 12;
    const opts = options || {};
    const basis = basisFromAxis(axis);
    const lower = [];
    const upper = [];
    const half = length * 0.5;
    for (let i = 0; i < count; i += 1) {
      const angle = i / count * TAU;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      lower.push(localPoint(center, basis, x, y, -half));
      upper.push(localPoint(center, basis, x, y, half));
    }
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      pushFace([lower[i], lower[next], upper[next], upper[i]], color, opts);
    }
    if (opts.caps !== false) {
      pushFace(upper, color, opts);
      pushFace(lower.slice().reverse(), color, opts);
    }
  }

  function addCylinderBetween(a, b, radius, color, options) {
    const axis = sub(b, a);
    const length = magnitude(axis);
    if (length < 0.1) return;
    addCylinder(midpoint(a, b), axis, radius, length, color, 10, options);
  }

  function addJoint(center, radius, color) {
    const slices = 6;
    const rings = 3;
    const rows = [];
    for (let r = 0; r <= rings; r += 1) {
      const latitude = -Math.PI / 2 + r / rings * Math.PI;
      const row = [];
      for (let i = 0; i < slices; i += 1) {
        const angle = i / slices * TAU;
        row.push(add(center, vec(
          Math.cos(latitude) * Math.cos(angle) * radius,
          Math.cos(latitude) * Math.sin(angle) * radius,
          Math.sin(latitude) * radius
        )));
      }
      rows.push(row);
    }
    for (let r = 0; r < rings; r += 1) {
      for (let i = 0; i < slices; i += 1) {
        const next = (i + 1) % slices;
        pushFace([rows[r][i], rows[r][next], rows[r + 1][next], rows[r + 1][i]], color, { lineWidth: 0.5 });
      }
    }
  }

  function addOrientedBox(center, extentX, extentY, extentZ, color, options) {
    const a = extentX;
    const b = extentY;
    const c = extentZ;
    const p = [
      add(center, add(scale(a, -1), add(scale(b, -1), scale(c, -1)))),
      add(center, add(a, add(scale(b, -1), scale(c, -1)))),
      add(center, add(a, add(b, scale(c, -1)))),
      add(center, add(scale(a, -1), add(b, scale(c, -1)))),
      add(center, add(scale(a, -1), add(scale(b, -1), c))),
      add(center, add(a, add(scale(b, -1), c))),
      add(center, add(a, add(b, c))),
      add(center, add(scale(a, -1), add(b, c)))
    ];
    pushFace([p[0], p[3], p[2], p[1]], color, options);
    pushFace([p[4], p[5], p[6], p[7]], color, options);
    pushFace([p[0], p[1], p[5], p[4]], color, options);
    pushFace([p[1], p[2], p[6], p[5]], color, options);
    pushFace([p[2], p[3], p[7], p[6]], color, options);
    pushFace([p[3], p[0], p[4], p[7]], color, options);
  }

  function addBox(center, sizeX, sizeY, sizeZ, color, options) {
    addOrientedBox(
      center,
      vec(sizeX * 0.5, 0, 0),
      vec(0, sizeY * 0.5, 0),
      vec(0, 0, sizeZ * 0.5),
      color,
      options
    );
  }

  function addFrustum(center, axis, lowerRadius, upperRadius, length, color, segments, options) {
    const count = segments || 12;
    const basis = basisFromAxis(axis);
    const lower = [];
    const upper = [];
    const half = length * 0.5;
    for (let i = 0; i < count; i += 1) {
      const angle = i / count * TAU;
      lower.push(localPoint(center, basis, Math.cos(angle) * lowerRadius, Math.sin(angle) * lowerRadius, -half));
      upper.push(localPoint(center, basis, Math.cos(angle) * upperRadius, Math.sin(angle) * upperRadius, half));
    }
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      pushFace([lower[i], lower[next], upper[next], upper[i]], color, options);
    }
    pushFace(upper, color, options);
    pushFace(lower.slice().reverse(), color, options);
  }

  function addGear(center, axis, rootRadius, outerRadius, thickness, teeth, color, phase, options) {
    const basis = basisFromAxis(axis);
    const opts = options || {};
    addCylinder(center, axis, rootRadius, thickness, color, Math.max(12, teeth), opts);
    const toothDepth = outerRadius - rootRadius;
    const toothWidth = TAU * (rootRadius + outerRadius) * 0.17 / teeth;
    for (let i = 0; i < teeth; i += 1) {
      const angle = phase + i * TAU / teeth;
      const radial = add(scale(basis.u, Math.cos(angle)), scale(basis.w, Math.sin(angle)));
      const tangent = add(scale(basis.u, -Math.sin(angle)), scale(basis.w, Math.cos(angle)));
      const toothCenter = add(center, scale(radial, rootRadius + toothDepth * 0.5));
      addOrientedBox(
        toothCenter,
        scale(tangent, toothWidth * 0.5),
        scale(radial, toothDepth * 0.5),
        scale(basis.n, thickness * 0.58),
        color,
        opts
      );
    }
  }

  function addBevelGear(center, axis, baseRadius, topRadius, length, teeth, color, phase, options) {
    const basis = basisFromAxis(axis);
    const opts = options || {};
    addFrustum(center, axis, baseRadius, topRadius, length, color, Math.max(10, teeth), opts);
    const toothDepth = Math.max(5, baseRadius - topRadius + 7);
    const toothWidth = TAU * baseRadius * 0.16 / teeth;
    for (let i = 0; i < teeth; i += 1) {
      const angle = phase + i * TAU / teeth;
      const radial = add(scale(basis.u, Math.cos(angle)), scale(basis.w, Math.sin(angle)));
      const tangent = add(scale(basis.u, -Math.sin(angle)), scale(basis.w, Math.cos(angle)));
      const toothCenter = add(
        add(center, scale(radial, (baseRadius + topRadius) * 0.52)),
        scale(basis.n, length * 0.18)
      );
      addOrientedBox(
        toothCenter,
        scale(tangent, toothWidth * 0.5),
        scale(radial, toothDepth * 0.32),
        scale(basis.n, length * 0.16),
        color,
        opts
      );
    }
  }

  function ringPoint(k, radius, angle, normalOffset) {
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    const base = vec(x, y, k.planeZ(x, y));
    return add(base, scale(k.normal, normalOffset || 0));
  }

  function ringFrame(k, angle) {
    const radial = normalize(vec(
      Math.cos(angle),
      Math.sin(angle),
      k.slopeX * Math.cos(angle) + k.slopeY * Math.sin(angle)
    ));
    const tangent = normalize(vec(
      -Math.sin(angle),
      Math.cos(angle),
      -k.slopeX * Math.sin(angle) + k.slopeY * Math.cos(angle)
    ));
    return { radial, tangent };
  }

  function addTiltedRing(k, outerRadius, innerRadius, thickness, color, options) {
    const opts = options || {};
    const segments = opts.segments || 24;
    const offset = opts.offset || 0;
    const half = thickness * 0.5;
    for (let i = 0; i < segments; i += 1) {
      const a = i / segments * TAU;
      const b = (i + 1) / segments * TAU;
      const outerTopA = ringPoint(k, outerRadius, a, offset + half);
      const outerTopB = ringPoint(k, outerRadius, b, offset + half);
      const innerTopA = ringPoint(k, innerRadius, a, offset + half);
      const innerTopB = ringPoint(k, innerRadius, b, offset + half);
      const outerBottomA = ringPoint(k, outerRadius, a, offset - half);
      const outerBottomB = ringPoint(k, outerRadius, b, offset - half);
      const innerBottomA = ringPoint(k, innerRadius, a, offset - half);
      const innerBottomB = ringPoint(k, innerRadius, b, offset - half);
      pushFace([outerTopA, outerTopB, innerTopB, innerTopA], color, opts);
      pushFace([outerBottomB, outerBottomA, innerBottomA, innerBottomB], color, opts);
      pushFace([outerBottomA, outerBottomB, outerTopB, outerTopA], color, opts);
      pushFace([innerBottomB, innerBottomA, innerTopA, innerTopB], color, opts);
    }
  }

  function addRingTab(k, angle, radius, tangentSize, radialSize, height, color, normalOffset) {
    const frame = ringFrame(k, angle);
    const center = ringPoint(k, radius, angle, normalOffset || 0);
    addOrientedBox(
      center,
      scale(frame.tangent, tangentSize * 0.5),
      scale(frame.radial, radialSize * 0.5),
      scale(k.normal, height * 0.5),
      color,
      { lineWidth: 0.65 }
    );
  }

  function addRod(a, b, radius, color, joints) {
    addCylinderBetween(a, b, radius, color, { lineWidth: 0.55 });
    if (joints !== false) {
      addJoint(a, radius * 1.8, color);
      addJoint(b, radius * 1.8, color);
    }
  }

  function fixedArmPivot(a, b, armLength, reference, side) {
    const span = sub(b, a);
    const halfSpan = magnitude(span) * 0.5;
    const midpointPoint = midpoint(a, b);
    let perpendicular = cross(span, reference);
    if (magnitude(perpendicular) < 1e-6) perpendicular = cross(span, VZ);
    if (magnitude(perpendicular) < 1e-6) perpendicular = cross(span, VY);
    const offset = Math.sqrt(Math.max(0, armLength * armLength - halfSpan * halfSpan));
    return add(midpointPoint, scale(normalize(perpendicular), offset * side));
  }

  function addTransmission() {
    // Two meshed stages: 12T→16T then compound 7T→30T.
    // phaseOut = -phaseIn * teethIn / teethOut + meshOffset at each mesh,
    // yielding a visible 5.714:1 turbine-to-mast reduction without a phase contradiction.
    const meshOffsetStage1 = Math.PI / 16;
    const meshOffsetStage2 = Math.PI / 30;
    const mainPhase = state.phase;
    const intermediatePhase = -(mainPhase - meshOffsetStage2) * 30 / 7;
    const inputPhase = -(intermediatePhase - meshOffsetStage1) * 16 / 12;
    const caseOptions = state.caseXray
      ? { opacity: 0.24, stroke: '#86aab8', lineWidth: 1.1 }
      : { opacity: 1, stroke: '#9dbac5', lineWidth: 1.1 };

    addBox(vec(-366, 0, 69), 158, 112, 108, C.staticDark, { lineWidth: 0.9 });
    addCylinder(vec(-353, 0, 70), vec(1, 0, 0), 52, 156, C.static, 12, { lineWidth: 0.75 });
    addCylinder(vec(-255, 0, 70), vec(1, 0, 0), 11, 304, C.power, 10, { lineWidth: 0.55 });
    addCylinder(vec(-204, 0, 70), vec(1, 0, 0), 34, 70, C.powerDark, 12, { lineWidth: 0.7 });
    addCylinder(vec(-204, 0, 70), vec(1, 0, 0), 26, 77, C.power, 12, { lineWidth: 0.65 });
    addCylinder(vec(-167, 0, 70), vec(1, 0, 0), 17, 30, C.darkMetal, 10, { lineWidth: 0.6 });
    addBevelGear(vec(-143, 0, 70), vec(1, 0, 0), 34, 18, 42, 12, C.power, inputPhase, { lineWidth: 0.52 });
    addBevelGear(vec(-84, 0, 86), VZ, 48, 29, 29, 16, C.powerDark, intermediatePhase, { lineWidth: 0.5 });
    addCylinder(vec(-84, 0, 114), VZ, 13, 84, C.rotatingDark, 10, { lineWidth: 0.58 });
    addGear(vec(-84, 0, 126), VZ, 14, 24, 14, 7, C.powerDark, intermediatePhase, { lineWidth: 0.5 });
    addGear(vec(0, 0, 126), VZ, 43, 60, 19, 30, C.power, mainPhase, { lineWidth: 0.5 });
    addCylinder(vec(0, 0, 249), VZ, 20, 272, C.rotating, 12, { lineWidth: 0.62 });
    const mastKeyRadial = vec(Math.cos(mainPhase), Math.sin(mainPhase), 0);
    const mastKeyTangent = vec(-Math.sin(mainPhase), Math.cos(mainPhase), 0);
    addOrientedBox(
      add(vec(0, 0, 255), scale(mastKeyRadial, 21)),
      scale(mastKeyTangent, 3.4),
      scale(mastKeyRadial, 3.6),
      vec(0, 0, 92),
      C.rotatingDark,
      { lineWidth: 0.45 }
    );
    addCylinder(vec(0, 0, 164), VZ, 33, 16, C.metal, 10, { lineWidth: 0.7 });
    addCylinder(vec(0, 0, 354), VZ, 35, 16, C.rotatingDark, 12, { lineWidth: 0.7 });
    addBox(vec(-42, 0, 100), 312, 166, 190, C.gearcase, caseOptions);
    addBox(vec(-42, -107, 101), 220, 10, 130, C.staticDark, { opacity: 0.88, lineWidth: 0.65 });
    addLabel(vec(-408, -15, 128), 'TURBOSHAFT', '#f0bd66');
    addLabel(vec(-232, -36, 124), 'FREEWHEEL', '#f0bd66');
    addLabel(vec(-12, -95, 190), '2-STAGE REDUCTION 5.71:1', '#c0d5dc');
    addLabel(vec(24, -6, 290), 'VERTICAL MAST', '#efad72');
  }

  function addServos(k) {
    k.servos.forEach((servo) => {
      const radial = vec(Math.cos(servo.angle), Math.sin(servo.angle), 0);
      const tangent = vec(-Math.sin(servo.angle), Math.cos(servo.angle), 0);
      const base = vec(
        DIM.servoMountR * Math.cos(servo.angle),
        DIM.servoMountR * Math.sin(servo.angle),
        139
      );
      const pistonTop = vec(base.x, base.y, 190 + servo.stroke);
      addOrientedBox(
        base,
        scale(radial, 27),
        scale(tangent, 22),
        vec(0, 0, 29),
        C.staticDark,
        { lineWidth: 0.75 }
      );
      addCylinder(vec(base.x, base.y, 166), VZ, 13, 14, C.static, 10, { lineWidth: 0.6 });
      addCylinderBetween(vec(base.x, base.y, 171), pistonTop, 6.7, C.control, { lineWidth: 0.5 });
      addJoint(pistonTop, 5, C.control);
      addRod(pistonTop, servo.anchor, 3.25, C.control, true);
      addLabel(add(base, vec(0, 0, 49)), 'SERVO ' + String.fromCharCode(65 + servo.index), '#8ee4ea');
    });
  }

  function addSwashplate(k) {
    addTiltedRing(k, DIM.nonrotOuterR, DIM.nonrotInnerR, 13, C.static, { lineWidth: 0.62 });
    addTiltedRing(k, DIM.rotOuterR, DIM.rotInnerR, 12, C.rotating, { offset: 13, lineWidth: 0.62 });

    k.servos.forEach((servo) => {
      addRingTab(k, servo.angle, 126, 19, 25, 14, C.staticLight, 0);
      addJoint(ringPoint(k, DIM.servoAnchorR, servo.angle, 0), 5.5, C.staticLight);
    });

    [0, Math.PI].forEach((angle) => {
      const frame = ringFrame(k, angle);
      const railBase = vec(154 * Math.cos(angle), 154 * Math.sin(angle), 242);
      addOrientedBox(
        railBase,
        scale(frame.radial, 10),
        scale(frame.tangent, 12),
        vec(0, 0, 88),
        C.staticDark,
        { lineWidth: 0.7 }
      );
      addRingTab(k, angle, 143, 20, 32, 13, C.staticLight, 0);
    });

    k.blades.forEach((blade) => {
      addRingTab(k, blade.psi, DIM.rotorAttachR, 17, 27, 14, C.rotating, 15);
      const marker = ringPoint(k, DIM.rotorAttachR, blade.psi, 22);
      addJoint(marker, 4.2, C.rotating);
    });

    addLabel(ringPoint(k, 132, 2.26, 6), 'NON-ROTATING RING', '#b9dae4');
    addLabel(ringPoint(k, 94, -1.02, 22), 'ROTATING RING', '#f4ad75');
    addLabel(vec(178, 0, 316), 'ANTI-ROTATION GUIDE', '#b9dae4');
  }

  function addBlade(k, blade) {
    const radial = vec(Math.cos(blade.psi), Math.sin(blade.psi), 0);
    const tangent = vec(-Math.sin(blade.psi), Math.cos(blade.psi), 0);
    const pitchRad = blade.pitch * DEG;
    const chord = add(scale(tangent, Math.cos(pitchRad)), scale(VZ, Math.sin(pitchRad)));
    const thickness = add(scale(tangent, -Math.sin(pitchRad)), scale(VZ, Math.cos(pitchRad)));
    const hub = vec(0, 0, DIM.hubZ);
    const gripCenter = add(hub, scale(radial, 80));
    const bladeCenter = add(hub, scale(radial, DIM.bladeRootR + DIM.bladeLength * 0.5));
    const tipCenter = add(hub, scale(radial, DIM.bladeRootR + DIM.bladeLength - 22));
    const hornBase = add(hub, scale(radial, DIM.pitchHornBaseR));
    const hornTip = pitchHornTip(blade.psi, blade.pitch);
    const linkStart = ringPoint(k, DIM.rotorAttachR, blade.psi, DIM.rotorLinkNormalOffset);

    addCylinder(gripCenter, radial, 18, 133, C.rotating, 10, { lineWidth: 0.58 });
    addCylinder(add(hub, scale(radial, 37)), radial, 23, 39, C.metal, 10, { lineWidth: 0.6 });
    addOrientedBox(
      bladeCenter,
      scale(radial, DIM.bladeLength * 0.5),
      scale(chord, 34),
      scale(thickness, 3.6),
      C.blade,
      { lineWidth: 0.72 }
    );
    addOrientedBox(
      tipCenter,
      scale(radial, 22),
      scale(chord, 34),
      scale(thickness, 4.1),
      C.bladeTip,
      { lineWidth: 0.68 }
    );
    addOrientedBox(
      add(bladeCenter, scale(chord, 28)),
      scale(radial, DIM.bladeLength * 0.47),
      scale(chord, 2.2),
      scale(thickness, 4.3),
      C.staticLight,
      { lineWidth: 0.4 }
    );
    addOrientedBox(
      midpoint(hornBase, hornTip),
      scale(radial, 7),
      scale(chord, DIM.pitchHornLength * 0.5),
      scale(thickness, 4.5),
      C.rotating,
      { lineWidth: 0.65 }
    );
    addJoint(hornTip, 5.4, C.rotating);
    addRod(linkStart, hornTip, 3.25, C.control, true);
  }

  function addRotorHead(k) {
    const hub = vec(0, 0, DIM.hubZ);
    addCylinder(vec(0, 0, 365), VZ, 35, 34, C.rotatingDark, 12, { lineWidth: 0.68 });
    addCylinder(hub, VZ, 59, 26, C.rotating, 14, { lineWidth: 0.72 });
    addCylinder(vec(0, 0, 405), VZ, 25, 29, C.metal, 12, { lineWidth: 0.62 });

    [0.37, Math.PI + 0.37].forEach((offset, index) => {
      const angle = state.phase + offset;
      const frame = ringFrame(k, angle);
      const lower = ringPoint(k, 84, angle, 22);
      const upper = add(vec(0, 0, 344), scale(frame.radial, 38));
      const pivot = fixedArmPivot(
        lower,
        upper,
        DIM.scissorArmLength,
        frame.tangent,
        index === 0 ? 1 : -1
      );
      addRod(lower, pivot, 3.5, C.rotating, true);
      addRod(pivot, upper, 3.5, C.rotating, true);
    });

    k.blades.forEach((blade) => addBlade(k, blade));
    addLabel(vec(44, -8, 439), 'HUB / PITCH HORNS', '#f2ad73');
    addLabel(vec(-82, -18, 344), 'SCISSOR LINKS', '#f2ad73');
    addLabel(vec(274, -65, 408), 'PITCH LINKS ×4', '#8ee9ef');
  }

  function buildScene(k) {
    addBox(vec(-10, 0, -19), 765, 510, 18, C.darkMetal, { opacity: 0.54, lineWidth: 0.38 });
    addTransmission();
    addServos(k);
    addSwashplate(k);
    addRotorHead(k);
  }

  const colorCache = new Map();

  function shadeColor(hex, factor) {
    let rgb = colorCache.get(hex);
    if (!rgb) {
      const value = hex.replace('#', '');
      rgb = {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16)
      };
      colorCache.set(hex, rgb);
    }
    return 'rgb('
      + Math.round(clamp(rgb.r * factor, 0, 255)) + ','
      + Math.round(clamp(rgb.g * factor, 0, 255)) + ','
      + Math.round(clamp(rgb.b * factor, 0, 255)) + ')';
  }

  function drawGrid(view) {
    const span = 620;
    const step = 100;
    ctx.save();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(111, 177, 192, 0.12)';
    for (let value = -span; value <= span; value += step) {
      drawWorldLine(vec(-span, value, -8), vec(span, value, -8), view);
      drawWorldLine(vec(value, -span, -8), vec(value, span, -8), view);
    }
    ctx.strokeStyle = 'rgba(43, 208, 219, 0.2)';
    ctx.lineWidth = 1;
    drawWorldLine(vec(-span, 0, -7), vec(span, 0, -7), view);
    drawWorldLine(vec(0, -span, -7), vec(0, span, -7), view);
    ctx.restore();
  }

  function drawWorldLine(a, b, view) {
    const p0 = project(a, view);
    const p1 = project(b, view);
    if (!p0 || !p1) return;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  function drawLabels(view) {
    ctx.save();
    ctx.font = '700 10px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.textBaseline = 'middle';
    labels.forEach((label) => {
      const point = project(label.point, view);
      if (!point || point.x < -20 || point.x > viewport.width + 20 || point.y < -20 || point.y > viewport.height + 20) return;
      const text = label.text;
      const width = ctx.measureText(text).width;
      const x = point.x + 8;
      const y = point.y - 8;
      ctx.fillStyle = 'rgba(3, 13, 18, 0.72)';
      ctx.fillRect(x - 4, y - 7, width + 8, 15);
      ctx.strokeStyle = 'rgba(162, 213, 223, 0.24)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x - 4, y - 7, width + 8, 15);
      ctx.fillStyle = label.color;
      ctx.fillText(text, x, y);
      ctx.strokeStyle = label.color;
      ctx.globalAlpha = 0.62;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(x - 3, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  function renderScene() {
    if (viewport.width < 2 || viewport.height < 2) return;
    const k = calculateKinematics();
    faces = [];
    labels = [];
    buildScene(k);
    const view = makeView();

    ctx.save();
    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    const background = ctx.createLinearGradient(0, 0, 0, viewport.height);
    background.addColorStop(0, '#102630');
    background.addColorStop(0.58, '#0a1921');
    background.addColorStop(1, '#061018');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    drawGrid(view);

    const projectedFaces = [];
    faces.forEach((face) => {
      const points = face.vertices.map((point) => project(point, view));
      if (points.some((point) => !point)) return;
      projectedFaces.push({
        face,
        points,
        depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length
      });
    });

    projectedFaces.sort((a, b) => b.depth - a.depth);
    projectedFaces.forEach((item) => {
      const face = item.face;
      const normalLight = Math.max(0, dot(face.normal, LIGHT));
      const factor = 0.38 + normalLight * 0.62;
      ctx.globalAlpha = face.opacity;
      ctx.beginPath();
      ctx.moveTo(item.points[0].x, item.points[0].y);
      for (let i = 1; i < item.points.length; i += 1) {
        ctx.lineTo(item.points[i].x, item.points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = shadeColor(face.color, factor);
      ctx.fill();
      if (face.lineWidth > 0) {
        ctx.strokeStyle = face.stroke;
        ctx.lineWidth = face.lineWidth;
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
    if (state.showLabels) drawLabels(view);
    ctx.restore();
  }

  function ensureAnimation() {
    if (document.hidden || raf) return;
    const targetRpm = state.running ? 360 * state.power : 0;
    if (targetRpm <= 0 && state.rpm < 0.15) return;
    lastFrame = performance.now();
    raf = requestAnimationFrame(animate);
  }

  function animate(timestamp) {
    raf = 0;
    if (document.hidden) {
      lastFrame = 0;
      return;
    }
    const elapsed = lastFrame ? timestamp - lastFrame : FRAME_INTERVAL;
    if (elapsed < FRAME_INTERVAL - 0.5) {
      raf = requestAnimationFrame(animate);
      return;
    }
    const dt = Math.min(MAX_DT, Math.max(0, elapsed / 1000));
    lastFrame = timestamp;
    const targetRpm = state.running ? 360 * state.power : 0;
    const timeConstant = targetRpm > state.rpm ? 1.8 : 3.2;
    state.rpm += (targetRpm - state.rpm) * (1 - Math.exp(-dt / timeConstant));
    if (!state.running && state.rpm < 0.12) state.rpm = 0;
    state.phase = (state.phase + TAU * (state.rpm / 60) * dt) % TAU;
    renderScene();
    updateTelemetry(false);
    if (targetRpm > 0 || state.rpm > 0.15) {
      raf = requestAnimationFrame(animate);
    } else {
      lastFrame = 0;
    }
  }

  function setPadFromPointer(event) {
    const rect = ui.cyclicPad.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const lateral = clamp((x - 0.5) / 0.35, -1, 1);
    const longitudinal = clamp((0.5 - y) / 0.35, -1, 1);
    setCyclic(lateral, longitudinal);
  }

  ui.powerRange.addEventListener('input', () => {
    state.power = Number(ui.powerRange.value) / 100;
    updateCommandReadouts();
    updateTelemetry(false);
    renderScene();
    ensureAnimation();
  });

  ui.collectiveRange.addEventListener('input', () => {
    state.collective = Number(ui.collectiveRange.value) / 100;
    updateCommandReadouts();
    updateTelemetry(false);
    renderScene();
  });

  ui.lateralRange.addEventListener('input', () => {
    setCyclic(Number(ui.lateralRange.value) / 100, state.longitudinal);
  });

  ui.longitudinalRange.addEventListener('input', () => {
    setCyclic(state.lateral, Number(ui.longitudinalRange.value) / 100);
  });

  [ui.lateralRange, ui.longitudinalRange].forEach((range) => {
    range.addEventListener('keydown', (event) => {
      if (event.key !== 'Home') return;
      event.preventDefault();
      setCyclic(0, 0);
    });
  });

  ui.cyclicPad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragPad = event.pointerId;
    ui.cyclicPad.setPointerCapture(event.pointerId);
    setPadFromPointer(event);
  });

  ui.cyclicPad.addEventListener('pointermove', (event) => {
    if (dragPad !== event.pointerId) return;
    setPadFromPointer(event);
  });

  function releasePad(event) {
    if (dragPad !== event.pointerId) return;
    dragPad = null;
    if (ui.cyclicPad.hasPointerCapture(event.pointerId)) ui.cyclicPad.releasePointerCapture(event.pointerId);
  }

  ui.cyclicPad.addEventListener('pointerup', releasePad);
  ui.cyclicPad.addEventListener('pointercancel', releasePad);

  ui.runButton.addEventListener('click', () => {
    state.running = !state.running;
    updateSystemStatus();
    updateTelemetry(true);
    renderScene();
    ensureAnimation();
  });

  ui.resetButton.addEventListener('click', () => {
    state.power = 0.65;
    state.collective = 0.35;
    state.lateral = 0;
    state.longitudinal = 0;
    state.phase = 0.48;
    state.running = !reducedMotion.matches;
    state.rpm = state.running ? 360 * state.power : 0;
    updateCommandReadouts();
    setCameraPreset('system');
    updateTelemetry(true);
    ensureAnimation();
  });

  ui.viewButtons.forEach((button) => {
    button.addEventListener('click', () => setCameraPreset(button.dataset.view));
  });

  ui.labelsToggle.addEventListener('click', () => {
    state.showLabels = !state.showLabels;
    updateDisplayToggles();
    renderScene();
  });

  ui.caseToggle.addEventListener('click', () => {
    state.caseXray = !state.caseXray;
    updateDisplayToggles();
    renderScene();
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragCamera = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    clearCameraPreset();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragCamera || dragCamera.id !== event.pointerId) return;
    const dx = event.clientX - dragCamera.x;
    const dy = event.clientY - dragCamera.y;
    dragCamera.x = event.clientX;
    dragCamera.y = event.clientY;
    camera.yaw -= dx * 0.008;
    camera.pitch = clamp(camera.pitch - dy * 0.007, -0.08, 1.17);
    renderScene();
  });

  function releaseCamera(event) {
    if (!dragCamera || dragCamera.id !== event.pointerId) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    dragCamera = null;
  }

  canvas.addEventListener('pointerup', releaseCamera);
  canvas.addEventListener('pointercancel', releaseCamera);
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.distance = clamp(camera.distance * Math.exp(event.deltaY * 0.001), 430, 1750);
    clearCameraPreset();
    renderScene();
  }, { passive: false });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = 0;
    } else {
      renderScene();
      ensureAnimation();
    }
  });

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
  } else {
    window.addEventListener('resize', resizeCanvas);
  }

  updateCommandReadouts();
  updateDisplayToggles();
  updateTelemetry(true);
  requestAnimationFrame(() => {
    resizeCanvas();
    ensureAnimation();
  });
})();
