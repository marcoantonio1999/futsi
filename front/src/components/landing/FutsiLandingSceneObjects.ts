import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// One shared scale keeps the posts, six-yard box, penalty spot and D aligned.
// IFAB Law 1: https://www.theifab.com/laws/latest/the-field-of-play/
const UNIT = 4.25 / 7.32;
export const PITCH = {
  groundY: -0.74, goalZ: -6.2, width: 68 * UNIT, length: 105 * UNIT,
  goalWidth: 7.32 * UNIT, goalHeight: 2.44 * UNIT, lineWidth: 0.10 * UNIT,
  goalAreaWidth: 18.32 * UNIT, goalAreaDepth: 5.5 * UNIT,
  penaltyAreaWidth: 40.32 * UNIT, penaltyAreaDepth: 16.5 * UNIT,
  penaltyDistance: 11 * UNIT, circleRadius: 9.15 * UNIT, cornerRadius: UNIT,
} as const;

function merged(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return geometry;
}


export function easeInOut(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function createBallTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(15, 23, 42, 0.75)";
  ctx.lineWidth = 4;
  for (let offset = -420; offset <= 420; offset += 96) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.quadraticCurveTo(256, 256, offset + 420, 512);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(15, 23, 42, 0.35)";
  ctx.lineWidth = 2;
  for (let offset = -360; offset <= 360; offset += 120) {
    ctx.beginPath();
    ctx.moveTo(0, offset);
    ctx.quadraticCurveTo(256, 256, 512, offset + 360);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createGrassTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#047857";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y += 64) {
    ctx.fillStyle = y % 128 === 0 ? "rgba(16, 185, 129, 0.18)" : "rgba(6, 95, 70, 0.18)";
    ctx.fillRect(0, y, canvas.width, 64);
  }

  for (let index = 0; index < 18000; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const length = 1 + Math.random() * 3;
    const alpha = 0.08 + Math.random() * 0.14;
    ctx.strokeStyle = Math.random() > 0.5 ? `rgba(209, 250, 229, ${alpha})` : `rgba(6, 78, 59, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 3 - 1.5, y + length);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  return texture;
}

export function createSoccerBall() {
  const radius = 0.34;
  const group = new THREE.Group();
  const ballTexture = createBallTexture();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 28),
    new THREE.MeshStandardMaterial({ color: "#ffffff", map: ballTexture, roughness: 0.34 }),
  );
  sphere.castShadow = true;
  group.add(sphere);

  const pentagonGeometry = new THREE.CircleGeometry(0.096, 5);
  const pentagonMaterial = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.38, side: THREE.DoubleSide });
  const phi = (1 + Math.sqrt(5)) / 2;
  const normals = [
    [0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi],
    [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0],
    [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1],
  ];
  const defaultNormal = new THREE.Vector3(0, 0, 1);
  const patches = new THREE.InstancedMesh(pentagonGeometry, pentagonMaterial, normals.length);
  const transform = new THREE.Object3D();
  normals.forEach(([x, y, z], index) => {
    const normal = new THREE.Vector3(x, y, z).normalize();
    transform.position.copy(normal).multiplyScalar(radius + 0.006);
    transform.quaternion.setFromUnitVectors(defaultNormal, normal);
    transform.rotateZ(index * 0.31);
    transform.updateMatrix();
    patches.setMatrixAt(index, transform.matrix);
  });
  patches.castShadow = true;
  patches.instanceMatrix.needsUpdate = true;
  group.add(patches);

  group.userData.ballTexture = ballTexture;
  return group;
}

export function createGoal() {
  const group = new THREE.Group();
  const width = PITCH.goalWidth, height = PITCH.goalHeight, depth = 1.2;
  const post = PITCH.lineWidth;
  const parts: THREE.BufferGeometry[] = [];
  const bar = (a: THREE.Vector3, b: THREE.Vector3, radius = post / 2) => {
    const direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 10);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(geometry);
  };
  for (const side of [-1, 1]) {
    const x = side * (width / 2 + post / 2);
    bar(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, height, 0));
    bar(new THREE.Vector3(x, post / 2, 0), new THREE.Vector3(x, post / 2, -depth));
    bar(new THREE.Vector3(x, 0, -depth), new THREE.Vector3(x, height, -depth * 0.40), post / 3);
    bar(new THREE.Vector3(x, height, 0), new THREE.Vector3(x, height, -depth * 0.40), post / 3);
  }
  bar(new THREE.Vector3(-width / 2 - post, height + post / 2, 0), new THREE.Vector3(width / 2 + post, height + post / 2, 0));
  bar(new THREE.Vector3(-width / 2, post / 2, -depth), new THREE.Vector3(width / 2, post / 2, -depth), post / 3);
  const frame = new THREE.Mesh(merged(parts), new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.45 }));
  frame.castShadow = true;
  group.add(frame);

  // Back, roof and both sides of the net share one draw call.
  const points: number[] = [];
  const line = (x: number, y: number, z: number, xx: number, yy: number, zz: number) => points.push(x, y, z, xx, yy, zz);
  const columns = 30, rows = 12, depthSteps = 8;
  for (let column = 0; column <= columns; column++) {
    const x = -width / 2 + width * column / columns;
    line(x, 0, -depth, x, height, -depth * 0.4);
    line(x, height, 0, x, height, -depth * 0.4);
  }
  for (let row = 0; row <= rows; row++) {
    const y = height * row / rows, z = -depth + depth * 0.6 * row / rows;
    line(-width / 2, y, z, width / 2, y, z);
    for (const side of [-1, 1]) line(side * width / 2, y, 0, side * width / 2, y, z);
  }
  for (let step = 0; step <= depthSteps; step++) {
    const t = step / depthSteps;
    line(-width / 2, height, -depth * 0.4 * t, width / 2, height, -depth * 0.4 * t);
    for (const side of [-1, 1]) line(side * width / 2, 0, -depth * t, side * width / 2, height, -depth * 0.4 * t);
  }
  const net = new THREE.BufferGeometry();
  net.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  group.add(new THREE.LineSegments(net, new THREE.LineBasicMaterial({ color: "#d5e6dc", transparent: true, opacity: 0.38 })));
  group.position.set(0, PITCH.groundY, PITCH.goalZ);
  return group;
}

export function createStands() {
  const group = new THREE.Group();
  group.name = "stadium-stands";
  const rows = 9, blocks = 4, seatsPerBlock = 11;
  const seatSpacing = 0.34, aisleWidth = 0.72;
  const blockWidth = seatsPerBlock * seatSpacing;
  const width = blocks * blockWidth + (blocks - 1) * aisleWidth;
  const frontZ = -8.65, tread = 0.40, rise = 0.22;
  // A seat has a cushion and an angled back, but all 396 seats are ONE mesh.
  const seatGeometry = merged([
    new THREE.BoxGeometry(0.27, 0.055, 0.25).translate(0, 0.12, 0),
    new THREE.BoxGeometry(0.27, 0.26, 0.045).rotateX(-0.12).translate(0, 0.25, -0.11),
  ]);
  const seats = new THREE.InstancedMesh(seatGeometry, new THREE.MeshStandardMaterial({ roughness: 0.82 }), rows * blocks * seatsPerBlock);
  const transform = new THREE.Object3D();
  const palette = ["#176e53", "#edf0dc", "#258264", "#9ab9a6"];
  let seatIndex = 0;
  const boxes: { x: number; y: number; z: number; w: number; h: number; d: number; color: string }[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: string) => boxes.push({x, y, z, w, h, d, color});
  const railPoints: number[] = [];
  const rail = (x: number, y: number, z: number, xx: number, yy: number, zz: number) => railPoints.push(x, y, z, xx, yy, zz);
  for (let row = 0; row < rows; row++) {
    const top = PITCH.groundY + 0.28 + row * rise, z = frontZ - row * tread;
    const h = top - PITCH.groundY;
    box(0, PITCH.groundY + h / 2, z, width + 0.6, h, tread, row % 2 ? "#40554d" : "#4b6056");
    for (let block = 0; block < blocks; block++) {
      for (let seat = 0; seat < seatsPerBlock; seat++) {
        transform.position.set(-width / 2 + block * (blockWidth + aisleWidth) + (seat + 0.5) * seatSpacing, top, z);
        transform.rotation.set(0, 0, 0);
        transform.scale.set(1, 1, 1);
        transform.updateMatrix();
        seats.setMatrixAt(seatIndex, transform.matrix);
        // Broad green/cream bands read as sections instead of multicolour noise.
        seats.setColorAt(seatIndex++, new THREE.Color(palette[row === 3 || row === 7 ? 1 : block % 2 ? 2 : 0]));
      }
      if (block < blocks - 1) {
        const x = -width / 2 + (block + 1) * blockWidth + block * aisleWidth + aisleWidth / 2;
        box(x, top + 0.012, z + tread / 2 - 0.025, aisleWidth, 0.025, 0.045, "#b5bc83");
        box(x, top + 0.055, z - 0.10, aisleWidth, 0.11, 0.20, "#637167");
        if (row % 3 === 0) rail(x, top, z, x, top + 0.62, z);
      }
    }
  }
  seats.instanceMatrix.needsUpdate = true;
  seats.instanceColor!.needsUpdate = true;
  group.add(seats);
  const rearZ = frontZ - (rows - 1) * tread - 0.32;
  const rearTop = PITCH.groundY + 0.28 + (rows - 1) * rise;
  // Low front wall, rear rail, connected aisle handrails and a lightweight roof.
  box(0, PITCH.groundY + 0.18, frontZ + 0.47, width + 0.8, 0.36, 0.16, "#183f30");
  box(0, rearTop + 0.25, rearZ, width + 0.8, 0.50, 0.14, "#243f34");
  const roofY = rearTop + 1.18;
  box(0, roofY, frontZ - 1.7, width + 1.2, 0.10, 4.5, "#203e32");
  box(0, roofY - 0.09, frontZ + 0.54, width + 1.2, 0.12, 0.08, "#9cb9a5");
  for (let post = 0; post <= 4; post++) {
    const x = -width / 2 + width * post / 4;
    box(x, (roofY + PITCH.groundY) / 2, rearZ, 0.075, roofY - PITCH.groundY, 0.075, "#799386");
    rail(x, rearTop + 0.5, rearZ, x, rearTop + 0.83, rearZ);
  }
  rail(-width / 2, rearTop + 0.83, rearZ, width / 2, rearTop + 0.83, rearZ);
  for (let block = 0; block < blocks - 1; block++) {
    const x = -width / 2 + (block + 1) * blockWidth + block * aisleWidth + aisleWidth / 2;
    rail(x, PITCH.groundY + 0.9, frontZ, x, rearTop + 0.62, frontZ - (rows - 1) * tread);
  }
  const structure = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.95 }), boxes.length);
  boxes.forEach((item, index) => {
    transform.position.set(item.x, item.y, item.z);
    transform.scale.set(item.w, item.h, item.d);
    transform.updateMatrix();
    structure.setMatrixAt(index, transform.matrix);
    structure.setColorAt(index, new THREE.Color(item.color));
  });
  structure.instanceMatrix.needsUpdate = true;
  structure.instanceColor!.needsUpdate = true;
  group.add(structure);
  const rails = new THREE.BufferGeometry();
  rails.setAttribute("position", new THREE.Float32BufferAttribute(railPoints, 3));
  group.add(new THREE.LineSegments(rails, new THREE.LineBasicMaterial({ color: "#a8bcae" })));
  return group;
}

export function createFieldLines() {
  const { goalZ, length, width, groundY, lineWidth } = PITCH;
  const parts: THREE.BufferGeometry[] = [];
  const y = groundY + 0.009;
  const stroke = (x: number, z: number, xx: number, zz: number) => {
    const dx = xx - x, dz = zz - z;
    const plane = new THREE.PlaneGeometry(lineWidth, Math.hypot(dx, dz));
    plane.rotateX(-Math.PI / 2);
    plane.rotateY(Math.atan2(dx, dz));
    plane.translate((x + xx) / 2, y, (z + zz) / 2);
    parts.push(plane);
  };
  const arc = (x: number, z: number, radius: number, start: number, end: number) => {
    const geometry = new THREE.RingGeometry(radius - lineWidth / 2, radius + lineWidth / 2, 64, 1, start, end - start);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(x, y, z);
    parts.push(geometry);
  };
  const spot = (z: number) => {
    const geometry = new THREE.CircleGeometry(lineWidth * 1.1, 16);
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, y, z); parts.push(geometry);
  };
  stroke(-width / 2, goalZ, width / 2, goalZ);
  stroke(-width / 2, goalZ + length, width / 2, goalZ + length);
  for (const side of [-1, 1]) stroke(side * width / 2, goalZ, side * width / 2, goalZ + length);
  const middle = goalZ + length / 2;
  stroke(-width / 2, middle, width / 2, middle);
  arc(0, middle, PITCH.circleRadius, 0, Math.PI * 2); spot(middle);
  for (const end of [0, 1]) {
    const baseline = goalZ + end * length, inward = end ? -1 : 1;
    for (const [boxWidth, depth] of [[PITCH.goalAreaWidth, PITCH.goalAreaDepth], [PITCH.penaltyAreaWidth, PITCH.penaltyAreaDepth]]) {
      const front = baseline + inward * depth;
      for (const side of [-1, 1]) stroke(side * boxWidth / 2, baseline, side * boxWidth / 2, front);
      stroke(-boxWidth / 2, front, boxWidth / 2, front);
    }
    const penaltyZ = baseline + inward * PITCH.penaltyDistance;
    spot(penaltyZ);
    // RingGeometry's positive angle points toward -Z after rotation.
    const angle = Math.asin((PITCH.penaltyAreaDepth - PITCH.penaltyDistance) / PITCH.circleRadius);
    const start = end ? angle : Math.PI + angle;
    arc(0, penaltyZ, PITCH.circleRadius, start, start + Math.PI - 2 * angle);
    arc(-width / 2, baseline, PITCH.cornerRadius, end ? 0 : Math.PI * 1.5, end ? Math.PI / 2 : Math.PI * 2);
    arc(width / 2, baseline, PITCH.cornerRadius, end ? Math.PI / 2 : Math.PI, end ? Math.PI : Math.PI * 1.5);
  }
  const mesh = new THREE.Mesh(merged(parts), new THREE.MeshBasicMaterial({ color: "#e0ead6", toneMapped: false }));
  mesh.name = "pitch-markings";
  return mesh;
}
