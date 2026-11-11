import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type { ActorPose } from './minionChoreography';

const RADIUS = 29;
const UP = new THREE.Vector3(0, 1, 0);
const limbDirection = new THREE.Vector3();

const makeDenimTexture = () => {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const weave = (x + y * 3) % 8 < 3 ? 237 : 211;
      const grain = ((x * 53) ^ (y * 79)) % 11;
      pixels[index] = weave + grain;
      pixels[index + 1] = weave + grain;
      pixels[index + 2] = weave + grain;
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

export const makeMinionMaterials = (denimTexture = makeDenimTexture()) => ({
  skin: new THREE.MeshPhysicalMaterial({
    color: '#ffbf20',
    roughness: 0.43,
    clearcoat: 0.28,
    clearcoatRoughness: 0.33
  }),
  denim: new THREE.MeshStandardMaterial({ color: '#3b739f', map: denimTexture, roughness: 0.9 }),
  denimDark: new THREE.MeshStandardMaterial({ color: '#21476b', roughness: 0.9 }),
  stitch: new THREE.MeshStandardMaterial({ color: '#7593a7', roughness: 0.85 }),
  metal: new THREE.MeshStandardMaterial({ color: '#c4c9c9', roughness: 0.29, metalness: 0.74 }),
  rim: new THREE.MeshStandardMaterial({ color: '#4e5056', roughness: 0.4, metalness: 0.46 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#24252b', roughness: 0.58 }),
  white: new THREE.MeshStandardMaterial({ color: '#fff7e3', roughness: 0.35 }),
  iris: new THREE.MeshStandardMaterial({ color: '#945731', roughness: 0.32 }),
  pupil: new THREE.MeshStandardMaterial({ color: '#171115', roughness: 0.24 }),
  mouth: new THREE.MeshStandardMaterial({ color: '#40201a', roughness: 0.92 }),
  brass: new THREE.MeshStandardMaterial({ color: '#dbb067', roughness: 0.43, metalness: 0.54 }),
  board: new THREE.MeshStandardMaterial({ color: '#443336', roughness: 0.51, metalness: 0.3 }),
  boardRim: new THREE.MeshStandardMaterial({ color: '#a17a48', roughness: 0.36, metalness: 0.54 })
});

type MinionMaterials = ReturnType<typeof makeMinionMaterials>;

const mesh = (
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0
) => {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  parent.add(object);
  return object;
};

const sphere = (
  parent: THREE.Object3D,
  material: THREE.Material,
  size: number,
  x: number,
  y: number,
  z: number,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1
) => {
  const object = mesh(parent, new THREE.SphereGeometry(size, 22, 14), material, x, y, z);
  object.scale.set(scaleX, scaleY, scaleZ);
  return object;
};

const curve = (
  parent: THREE.Object3D,
  material: THREE.Material,
  radius: number,
  points: number[][]
) =>
  mesh(
    parent,
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
      14,
      radius,
      6,
      false
    ),
    material
  );

const makePants = (root: THREE.Group, materials: MinionMaterials) => {
  const limit = Math.acos(1 - 27 / RADIUS);
  const lower = Array.from({ length: 13 }, (_, index) => {
    const angle = (limit * index) / 12;
    return new THREE.Vector2(
      Math.sin(angle) * (RADIUS + 0.7),
      10.8 + RADIUS * (1 - Math.cos(angle))
    );
  });
  mesh(root, new THREE.LatheGeometry(lower, 40), materials.denim);
  const bib = mesh(root, new RoundedBoxGeometry(33, 21, 5, 3, 2.4), materials.denim, 0, 40.5, 26.6);
  bib.rotation.x = -0.03;
  mesh(root, new RoundedBoxGeometry(17, 10, 1.8, 2, 0.8), materials.denimDark, 0, 41, 29.8);
  curve(root, materials.stitch, 0.45, [
    [-7, 43, 31],
    [-6, 37, 31],
    [0, 36, 31],
    [6, 37, 31],
    [7, 43, 31]
  ]);
  for (const side of [-1, 1]) {
    curve(root, materials.denim, 3.3, [
      [side * 14, 48, 27],
      [side * 20, 54, 23],
      [side * 27, 62, 12],
      [side * 29, 64, 1],
      [side * 25, 56, -16],
      [side * 17, 40, -24]
    ]);
    sphere(root, materials.brass, 2, side * 14, 49, 31, 1, 1, 0.46);
  }
};

const makeFace = (root: THREE.Group, materials: MinionMaterials, height: number, eyes: 1 | 2) => {
  const eyeY = height - 18;
  mesh(
    root,
    new THREE.CylinderGeometry(29.8, 29.8, 5.8, 40, 1, true),
    materials.rubber,
    0,
    eyeY,
    0
  );
  const irisGroups = (eyes === 1 ? [0] : [-13.4, 13.4]).map((x) => {
    const eye = new THREE.Group();
    eye.position.set(x, eyeY, eyes === 1 ? 28.8 : 26.8);
    eye.rotation.y = x * 0.008;
    root.add(eye);
    const radius = eyes === 1 ? 17.1 : 12.15;
    const casing = mesh(
      eye,
      new THREE.CylinderGeometry(radius + 1.3, radius + 1.6, 6.6, 34),
      materials.rim,
      0,
      0,
      2
    );
    casing.rotation.x = Math.PI / 2;
    mesh(eye, new THREE.TorusGeometry(radius, 2.1, 10, 36), materials.metal, 0, 0, 6.1);
    mesh(eye, new THREE.TorusGeometry(radius - 2.6, 0.64, 8, 32), materials.rim, 0, 0, 6.6);
    const expression = new THREE.Group();
    expression.position.z = 6.2;
    eye.add(expression);
    sphere(expression, materials.white, radius - 2.6, 0, 0, 0, 1, 1, 0.21);
    const iris = new THREE.Group();
    iris.position.z = (radius - 2.6) * 0.19;
    expression.add(iris);
    sphere(iris, materials.iris, radius * 0.43, 0, 0, 0, 1, 1, 0.22);
    sphere(iris, materials.pupil, radius * 0.23, 0, 0, 1.1, 1, 1, 0.3);
    sphere(iris, materials.white, radius * 0.1, -1.45, 1.8, 2.4, 1, 1, 0.34);
    return { expression, iris };
  });

  const smile = new THREE.Group();
  root.add(smile);
  smile.position.set(0, Math.max(53, eyeY - (eyes === 1 ? 21 : 19)), 29.5);
  const mouth = new THREE.Shape();
  mouth.moveTo(-9.6, 0);
  mouth.quadraticCurveTo(0, -3, 9.6, 1);
  mouth.quadraticCurveTo(6.8, -10, 0, -9.2);
  mouth.quadraticCurveTo(-7.6, -8.8, -9.6, 0);
  mesh(smile, new THREE.ShapeGeometry(mouth, 12), materials.mouth);
  const teeth = new THREE.Shape();
  teeth.moveTo(-7.5, -0.35);
  teeth.quadraticCurveTo(0, -2.6, 7.7, 0.55);
  teeth.quadraticCurveTo(5.8, -4.8, -5.8, -3.1);
  teeth.lineTo(-7.5, -0.35);
  mesh(smile, new THREE.ShapeGeometry(teeth, 8), materials.white, 0, 0, 0.3);

  for (const side of [-1, 0, 1]) {
    curve(root, materials.rubber, 1.2, [
      [side * 5, height + 9, 3],
      [side * 9 + 1, height + 16, 2],
      [side * 13 + 4, height + 18 - Math.abs(side) * 3, 3]
    ]);
  }
  return { irisGroups, smile };
};

const makeArm = (parent: THREE.Group, materials: MinionMaterials) => {
  const cylinder = new THREE.CylinderGeometry(3.5, 3.9, 1, 12);
  const upper = mesh(parent, cylinder, materials.skin);
  const lower = mesh(parent, cylinder, materials.skin);
  const joint = sphere(parent, materials.skin, 3.85, 0, 0, 0);
  const mitten = new THREE.Group();
  sphere(mitten, materials.rubber, 5.7, 0, 0, 0, 0.88, 1.16, 0.8);
  sphere(mitten, materials.rubber, 3.2, 4.2, 1.1, 1.2, 0.95, 1.05, 0.82);
  parent.add(mitten);
  return { upper, lower, joint, mitten };
};

const makeLeg = (parent: THREE.Group, materials: MinionMaterials, side: number) => {
  const foot = new THREE.Group();
  foot.position.x = side * 12;
  mesh(foot, new RoundedBoxGeometry(15, 9, 21, 2, 3.8), materials.rubber, 0, 4.5, 5);
  mesh(foot, new RoundedBoxGeometry(15.3, 2.3, 21.2, 2, 1), materials.rubber, 0, 1.4, 5);
  mesh(foot, new THREE.CylinderGeometry(5.1, 4.9, 11, 14), materials.denimDark, 0, 10.3, 0);
  parent.add(foot);
  return foot;
};

const makeBoard = (
  parent: THREE.Group,
  materials: MinionMaterials,
  displayTexture: THREE.CanvasTexture
) => {
  const board = new THREE.Group();
  parent.add(board);
  mesh(board, new RoundedBoxGeometry(105, 49, 9, 3, 5.8), materials.board, 0, 0, 0);
  mesh(board, new RoundedBoxGeometry(101, 45, 1.8, 3, 0.89), materials.boardRim, 0, 0, 4.8);
  const display = mesh(
    board,
    new THREE.PlaneGeometry(96, 40),
    new THREE.MeshBasicMaterial({ map: displayTexture, toneMapped: false }),
    0,
    0,
    5.9
  );
  const off = mesh(
    board,
    new THREE.PlaneGeometry(96, 40),
    new THREE.MeshBasicMaterial({ color: '#20262a', toneMapped: false }),
    0,
    0,
    5.91
  );
  for (const x of [-34, 34]) {
    mesh(board, new THREE.CylinderGeometry(3, 3, 11, 12), materials.board, x, -23.5, 1);
  }
  board.visible = false;
  return { board, display, off };
};

const positionLimb = (limb: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) => {
  limbDirection.subVectors(b, a);
  limb.position.copy(a).lerp(b, 0.5);
  limb.scale.y = limbDirection.length();
  limb.quaternion.setFromUnitVectors(UP, limbDirection.normalize());
};

export const createMinionModel = (
  materials: MinionMaterials,
  height: number,
  eyes: 1 | 2,
  displayTexture?: THREE.CanvasTexture
) => {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  mesh(
    body,
    new THREE.CapsuleGeometry(RADIUS, height - RADIUS * 2, 12, 40),
    materials.skin,
    0,
    11 + height / 2,
    0
  );
  makePants(body, materials);
  const { irisGroups, smile } = makeFace(body, materials, height, eyes);
  const feet = [-1, 1].map((side) => makeLeg(root, materials, side));
  const arms = [-1, 1].map(() => makeArm(body, materials));
  const lamp = displayTexture ? makeBoard(body, materials, displayTexture) : null;
  const shoulder = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const hand = new THREE.Vector3();

  const applyPose = (pose: ActorPose, lit: boolean) => {
    const stride = Math.sin(pose.step);
    const crouch = pose.brace * 9 + pose.duck * 16;
    body.position.y = -crouch + Math.abs(Math.cos(pose.step)) * pose.pace * 2.7;
    body.scale.set(1 + pose.brace * 0.04, 1 - pose.brace * 0.08 - pose.duck * 0.08, 1);
    root.rotation.set(
      0.12 + pose.duck * 0.14,
      pose.turn,
      -pose.turn * pose.pace * 0.11 + pose.duck * 0.16
    );
    smile.scale.y = 1 + pose.reach * 0.55 + pose.brace * 0.4;
    for (const { expression, iris } of irisGroups) {
      expression.scale.y = 1 - pose.blink * 0.93;
      iris.position.x = pose.glance * 3.1;
      iris.position.y = lit ? 1.45 : -pose.duck;
    }
    const signY = 58 + (height - 28) * pose.signLift;
    const signZ = 38 - pose.signLift * 11;
    if (lamp) {
      lamp.board.visible = lit || pose.signLift > 0.42;
      lamp.board.position.set(0, signY, signZ);
      lamp.board.rotation.x = 0.24 * (1 - pose.signLift);
      lamp.display.visible = lit;
      lamp.off.visible = !lit;
    }
    for (const [index, side] of [-1, 1].entries()) {
      const phase = stride * side;
      const foot = feet[index];
      foot.position.set(
        side * 12 + side * pose.brace * 4.5,
        Math.max(0, phase) * pose.pace * 7,
        phase * pose.pace * 11
      );
      foot.rotation.set(phase * pose.pace * 0.5, side * (0.08 + pose.brace * 0.2), 0);
      const arm = arms[index];
      shoulder.set(side * 26, 46, 2);
      elbow.set(
        side * (34 + pose.reach * 4),
        31 + pose.reach * 15 + pose.duck * 16,
        3 - phase * pose.pace * 8
      );
      hand.set(
        side * (35 + pose.reach * 16 - pose.duck * 10),
        20 + pose.reach * 26 + pose.duck * 37,
        8 - phase * pose.pace * 15 + pose.duck * 23
      );
      if (pose.signLift >= 0) {
        elbow.set(side * (38 + pose.signLift * 5), 39 + pose.signLift * 28, signZ * 0.48);
        hand.set(side * 34, signY - 26, signZ + 1);
      }
      positionLimb(arm.upper, shoulder, elbow);
      positionLimb(arm.lower, elbow, hand);
      arm.joint.position.copy(elbow);
      arm.mitten.position.copy(hand);
      arm.mitten.scale.x = -side;
      arm.mitten.rotation.z = side * (pose.signLift >= 0 ? 0.32 : -0.2);
    }
  };

  return { root, applyPose };
};
