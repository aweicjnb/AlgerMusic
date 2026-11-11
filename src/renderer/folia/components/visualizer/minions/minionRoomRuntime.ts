import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import {
  getMinionFrame,
  MINION_CAST,
  MINION_HOLDERS,
  MINION_STAGE_HEIGHT,
  MINION_STAGE_WIDTH
} from './minionChoreography';
import type { MinionCue } from './minionCues';
import { createMinionModel, makeMinionMaterials } from './minionModel';
import environmentUrl from './room-environment.bin?url';
import environmentSize from './room-environment.json';

const W = MINION_STAGE_WIDTH;
const H = MINION_STAGE_HEIGHT;
const worldX = (x: number) => x - W / 2;
const worldY = (y: number) => H / 2 - y;
const depth = (y: number) => (y - 350) * 3;

interface MinionRuntimeDiagnostics {
  setSetupStage: (stage: 'webgl-context' | 'environment' | 'models' | 'shaders') => void;
  shaderError: (status: {
    contextLost: boolean;
    linked: boolean;
    vertexCompiled: boolean;
    fragmentCompiled: boolean;
  }) => void;
}

const canvasTexture = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Minion room requires a 2D canvas for textures');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { context, texture };
};

const radialTexture = (inner: string) => {
  const { context, texture } = canvasTexture(128, 128);
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.5, inner.replace(/,[^,]+\)$/, ', 0.2)'));
  gradient.addColorStop(1, 'transparent');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return texture;
};

const makeShadow = (scene: THREE.Scene, map: THREE.Texture) => {
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    toneMapped: false
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(100, 24), material);
  scene.add(shadow);
  return shadow;
};

const makeBall = (scene: THREE.Scene) => {
  const ball = new THREE.Group();
  ['#e14e3a', '#f2d9a1', '#58a4ab', '#f2d9a1', '#d77d39', '#f2d9a1'].forEach((color, index) => {
    const angle = Math.PI / 3;
    ball.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(11, 8, 16, index * angle, angle),
        new THREE.MeshPhysicalMaterial({ color, roughness: 0.34, clearcoat: 0.4 })
      )
    );
  });
  scene.add(ball);
  return ball;
};

const makePillow = (scene: THREE.Scene) => {
  const pillow = new THREE.Group();
  const fill = new THREE.MeshStandardMaterial({ color: '#70a5a1', roughness: 0.92 });
  const piping = new THREE.MeshStandardMaterial({ color: '#35625d', roughness: 0.86 });
  pillow.add(new THREE.Mesh(new RoundedBoxGeometry(34, 22, 9, 4, 4.3), fill));
  const seam = new THREE.Mesh(new RoundedBoxGeometry(34.6, 22.6, 1.35, 3, 0.65), piping);
  pillow.add(seam);
  scene.add(pillow);
  return pillow;
};

const addSofaDepth = (scene: THREE.Scene) => {
  const shape = new THREE.Shape();
  shape.moveTo(worldX(120), worldY(302));
  shape.bezierCurveTo(worldX(130), worldY(272), worldX(113), worldY(237), worldX(116), worldY(210));
  shape.bezierCurveTo(worldX(118), worldY(177), worldX(144), worldY(163), worldX(182), worldY(168));
  shape.lineTo(worldX(205), worldY(310));
  shape.closePath();
  const occluder = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 20),
    new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  );
  occluder.position.z = -79;
  occluder.renderOrder = -1;
  scene.add(occluder);
};

export class MinionRoomRuntime {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 2200);
  private environmentTexture?: THREE.DataTexture;
  private readonly display = canvasTexture(512, 212);
  private readonly shadowTexture = radialTexture('rgba(49, 21, 16, 0.56)');
  private readonly glowTexture = radialTexture('rgba(255, 189, 73, 0.38)');
  private readonly actors: ReturnType<typeof createMinionModel>[] = [];
  private readonly shadows: ReturnType<typeof makeShadow>[] = [];
  private resourcesPrepared = false;
  private destroyed = false;
  private readonly ball = makeBall(this.scene);
  private readonly pillow = makePillow(this.scene);
  private readonly ballShadow = makeShadow(this.scene, this.shadowTexture);
  private readonly pillowShadow = makeShadow(this.scene, this.shadowTexture);
  private readonly signGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(171, 97),
    new THREE.MeshBasicMaterial({
      map: this.glowTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false
    })
  );
  private readonly signLight = new THREE.PointLight(0xffbd67, 0, 105, 2);
  private text = '';
  private width = 0;
  private height = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly diagnostics: MinionRuntimeDiagnostics
  ) {
    diagnostics.setSetupStage('webgl-context');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      diagnostics.shaderError({
        contextLost: gl.isContextLost(),
        linked: gl.getProgramParameter(program, gl.LINK_STATUS) === true,
        vertexCompiled: gl.getShaderParameter(vertex, gl.COMPILE_STATUS) === true,
        fragmentCompiled: gl.getShaderParameter(fragment, gl.COMPILE_STATUS) === true
      });
    };
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.camera.position.z = 1150;
    this.scene.add(new THREE.HemisphereLight(0xf3d7af, 0x98604b, 0.77));
    const key = new THREE.DirectionalLight(0xffd49e, 1.83);
    key.position.set(-480, 540, 640);
    const fill = new THREE.DirectionalLight(0x9fdde9, 1.5);
    fill.position.set(380, 230, -370);
    this.scene.add(key, fill, this.signLight, this.signGlow);
  }

  async prepare() {
    const yieldFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!this.resourcesPrepared) {
      await yieldFrame();
      if (this.destroyed) return;
      this.diagnostics.setSetupStage('environment');
      const response = await fetch(environmentUrl);
      if (!response.ok) throw new Error('Minion environment could not load');
      const pixels = await response.arrayBuffer();
      if (this.destroyed) return;
      this.environmentTexture = new THREE.DataTexture(
        new Uint16Array(pixels),
        environmentSize.width,
        environmentSize.height,
        THREE.RGBAFormat,
        THREE.HalfFloatType
      );
      this.environmentTexture.mapping = THREE.CubeUVReflectionMapping;
      this.environmentTexture.colorSpace = THREE.LinearSRGBColorSpace;
      this.environmentTexture.minFilter = THREE.LinearFilter;
      this.environmentTexture.magFilter = THREE.LinearFilter;
      this.environmentTexture.needsUpdate = true;
      this.scene.environment = this.environmentTexture;
      this.scene.environmentIntensity = 0.55;
      addSofaDepth(this.scene);

      await yieldFrame();
      if (this.destroyed) return;
      this.diagnostics.setSetupStage('models');
      const materials = makeMinionMaterials();
      for (const [index, { height, eyes }] of MINION_CAST.entries()) {
        if (this.destroyed) return;
        this.shadows.push(makeShadow(this.scene, this.shadowTexture));
        const model = createMinionModel(
          materials,
          height,
          eyes,
          index < MINION_HOLDERS ? this.display.texture : undefined
        );
        this.scene.add(model.root);
        this.actors.push(model);
        await yieldFrame();
      }
      this.resourcesPrepared = true;
    }
    if (this.destroyed) return;
    this.diagnostics.setSetupStage('shaders');
    // Let KHR_parallel_shader_compile finish before the first visible render.
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0 || (width === this.width && height === this.height)) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5, 2000 / width));
    this.renderer.setSize(width, height, false);
  }

  private paintSign(text: string) {
    const { context, texture } = this.display;
    const { width, height } = context.canvas;
    const screen = context.createLinearGradient(0, 0, 0, height);
    screen.addColorStop(0, '#132735');
    screen.addColorStop(1, '#202625');
    context.fillStyle = screen;
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#724b32';
    for (let y = 9; y < height; y += 12) {
      for (let x = 9; x < width; x += 12) {
        context.beginPath();
        context.arc(x, y, 1.35, 0, Math.PI * 2);
        context.fill();
      }
    }
    const family = '"Microsoft YaHei UI", "PingFang SC", sans-serif';
    context.font = `900 154px ${family}`;
    const measured = context.measureText(text);
    context.font = `900 ${Math.min(154, (154 * (width - 42)) / Math.max(1, measured.width))}px ${family}`;
    context.fillStyle = '#fff4c4';
    context.shadowColor = '#ffb458';
    context.shadowBlur = 21;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height * 0.54);
    context.shadowBlur = 0;
    texture.needsUpdate = true;
  }

  draw(cues: MinionCue[], time: number, reducedMotion: boolean): boolean {
    if (!this.width || !this.height) return false;
    const { actors, active, ball, pillow } = getMinionFrame(cues, time, reducedMotion);
    if (active && active.text !== this.text) {
      this.text = active.text;
      this.paintSign(this.text);
    }
    this.signLight.intensity = 0;
    this.signGlow.visible = false;
    actors.forEach((pose, index) => {
      const { scale, height } = MINION_CAST[index];
      const model = this.actors[index];
      const lit = active?.holder === index;
      const z = depth(pose.y);
      model.root.position.set(worldX(pose.x), worldY(pose.y) + pose.jump * scale, z);
      model.root.scale.setScalar(scale);
      model.applyPose(pose, lit);
      const shadow = this.shadows[index];
      shadow.position.set(worldX(pose.x) - 1.5, worldY(pose.y) + 1, z - 2);
      shadow.scale.setScalar(scale * (1 + pose.jump * 0.012));
      shadow.material.opacity = 0.89 - pose.jump * 0.021;
      if (lit) {
        const displayY = 58 + (height - 28) * pose.signLift;
        this.signGlow.visible = true;
        this.signGlow.position.set(worldX(pose.x), worldY(pose.y) + displayY * scale, z + 27);
        this.signGlow.scale.setScalar(scale);
        this.signLight.position.set(
          worldX(pose.x) + 2,
          worldY(pose.y) + (displayY - 13) * scale,
          z + 46
        );
        this.signLight.intensity = 1200;
      }
    });
    this.ball.position.set(worldX(ball.x), worldY(ball.y) + ball.height, depth(ball.y) + 14);
    this.ball.rotation.set(0.32, 0.4, ball.spin);
    this.pillow.position.set(
      worldX(pillow.x),
      worldY(pillow.y) + pillow.height,
      depth(pillow.y) + 19
    );
    this.pillow.rotation.set(pillow.spin * 0.42, 0.24 + pillow.spin * 0.61, pillow.spin);
    this.ballShadow.position.set(worldX(ball.x), worldY(ball.y), depth(ball.y));
    this.pillowShadow.position.set(worldX(pillow.x), worldY(pillow.y), depth(pillow.y));
    this.ballShadow.scale.setScalar(0.32 + ball.height * 0.003);
    this.pillowShadow.scale.setScalar(0.42 + pillow.height * 0.002);
    this.ballShadow.material.opacity = 0.68 - ball.height * 0.01;
    this.pillowShadow.material.opacity = Math.max(0, 0.5 - pillow.height * 0.005);
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  destroy() {
    this.destroyed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
        }
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial && material.map)
        textures.add(material.map);
      material.dispose();
    });
    textures.forEach((texture) => texture.dispose());
    this.display.texture.dispose();
    this.shadowTexture.dispose();
    this.glowTexture.dispose();
    this.environmentTexture?.dispose();
    this.renderer.dispose();
  }
}
