// 木鱼的 3D 版本：只在需要时由 app.js 动态 import，首屏不加载 three.js
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";

const WOOD = 0xd19057;
const WOOD_DARK = 0x7a4a22;
const SLOT = 0x3f2210;

// 四阶色阶贴图，做出动画赛璐璐的分层明暗
function makeGradientMap() {
  const data = new Uint8Array([110, 175, 220, 248]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// 接触阴影：一张径向渐变贴图，比实时阴影便宜得多
function makeShadowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(70,45,15,0.45)");
  g.addColorStop(0.55, "rgba(70,45,15,0.18)");
  g.addColorStop(1, "rgba(70,45,15,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildMuyu(gradientMap) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshToonMaterial({ color: WOOD, gradientMap });
  const darkMat = new THREE.MeshToonMaterial({ color: WOOD_DARK, gradientMap });
  const slotMat = new THREE.MeshToonMaterial({ color: SLOT, gradientMap });

  // 直接把 SVG 里那条手绘轮廓挤出成立体，形状与插画完全一致
  const DEPTH = 0.62;
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-1.02, -0.02);
  bodyShape.bezierCurveTo(-1.02, 0.44, -0.6, 0.83, 0, 0.83);
  bodyShape.bezierCurveTo(0.6, 0.83, 1.02, 0.44, 1.02, -0.02);
  bodyShape.bezierCurveTo(1.02, -0.5, 0.6, -0.83, 0, -0.83);
  bodyShape.bezierCurveTo(-0.6, -0.83, -1.02, -0.5, -1.02, -0.02);
  bodyShape.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: DEPTH,
    curveSegments: 32,
    bevelEnabled: true,
    bevelThickness: 0.24,
    bevelSize: 0.3,
    bevelSegments: 12
  });
  bodyGeo.translate(0, 0, -DEPTH / 2);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // 倒角会向两侧鼓出，正面平面在 depth/2 + bevelThickness 处
  const front = DEPTH / 2 + 0.26 + 0.012;

  // 鱼嘴缝：同一套坐标里的柳叶形，贴在正面
  const slotShape = new THREE.Shape();
  slotShape.moveTo(-0.86, 0.24);
  slotShape.quadraticCurveTo(0, 0.12, 0.86, 0.24);
  slotShape.quadraticCurveTo(0, -0.12, -0.86, 0.24);
  const slotGeo = new THREE.ExtrudeGeometry(slotShape, {
    depth: 0.08,
    curveSegments: 20,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 3
  });
  const slot = new THREE.Mesh(slotGeo, slotMat);
  slot.position.z = front - 0.06;
  group.add(slot);

  // 鱼眼
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), slotMat);
  eye.position.set(0.6, 0.34, front + 0.005);
  group.add(eye);

  // 底座
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.16, 40), darkMat);
  base.position.y = -0.94;
  group.add(base);

  return group;
}

export function createMuyuScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0.95, 0.72, 5.5);
  camera.lookAt(0, -0.06, 0);

  const gradientMap = makeGradientMap();
  const muyu = buildMuyu(gradientMap);
  scene.add(muyu);

  scene.add(new THREE.HemisphereLight(0xeaf7ff, 0xffe9c4, 1.35));
  const key = new THREE.DirectionalLight(0xfff2d6, 2.1);
  key.position.set(-2.4, 3.6, 3.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd6e9ff, 0.8);
  fill.position.set(3.4, 1.6, -1.8);
  scene.add(fill);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshBasicMaterial({
      map: makeShadowTexture(),
      transparent: true,
      depthWrite: false
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.02;
  scene.add(shadow);

  const state = {
    hitAt: -1,
    t: 0,
    disposed: false,
    raf: 0
  };

  const knock = [
    [0, 1, 1],
    [0.14, 1.03, 0.97],
    [0.32, 0.93, 0.87],
    [0.54, 1.04, 0.99],
    [0.74, 0.985, 1.01],
    [1, 1, 1]
  ];

  function knockAt(t) {
    for (let i = 1; i < knock.length; i++) {
      if (t <= knock[i][0]) {
        const [t0, sx0, sy0] = knock[i - 1];
        const [t1, sx1, sy1] = knock[i];
        const k = (t - t0) / (t1 - t0);
        const e = k * k * (3 - 2 * k);
        return [sx0 + (sx1 - sx0) * e, sy0 + (sy1 - sy0) * e];
      }
    }
    return [1, 1];
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame(dt) {
    state.t += dt;
    const idle = state.t;

    let sx = 1;
    let sy = 1;
    if (state.hitAt >= 0) {
      const k = state.t - state.hitAt;
      if (k < 0.34) {
        const [a, b] = knockAt(k / 0.34);
        sx = a;
        sy = b;
      } else {
        state.hitAt = -1;
      }
    }

    muyu.scale.set(sx, sy, sx);
    muyu.position.y = Math.sin(idle * 1.3) * 0.035 - (1 - sy) * 0.18;
    muyu.rotation.y = Math.sin(idle * 0.55) * 0.16 + (1 - sx) * 1.2;
    muyu.rotation.z = (1 - sx) * 0.25;

    renderer.render(scene, camera);
  }

  let last = performance.now();
  function loop(now) {
    if (state.disposed) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    frame(dt);
    state.raf = requestAnimationFrame(loop);
  }

  const ro =
    "ResizeObserver" in window
      ? new ResizeObserver(() => resize())
      : null;

  function start() {
    resize();
    ro?.observe(canvas);
    last = performance.now();
    state.raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function onVisibility() {
    if (document.hidden) stop();
    else if (!state.raf && !state.disposed) {
      last = performance.now();
      state.raf = requestAnimationFrame(loop);
    }
  }

  function onContextLost(event) {
    event.preventDefault();
    dispose();
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    ro?.disconnect();
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        if (obj.material.gradientMap) obj.material.gradientMap.dispose();
        obj.material.dispose();
      }
    });
    renderer.dispose();
  }

  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onContextLost);
  start();

  return {
    tap() {
      state.hitAt = state.t;
    },
    dispose
  };
}
