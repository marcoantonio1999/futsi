import * as THREE from "three";

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

  for (let index = 0; index < 4200; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const length = 5 + Math.random() * 14;
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
  texture.repeat.set(4, 4);
  return texture;
}

export function createSoccerBall() {
  const radius = 0.34;
  const group = new THREE.Group();
  const ballTexture = createBallTexture();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 96),
    new THREE.MeshStandardMaterial({ color: "#ffffff", map: ballTexture ?? undefined, roughness: 0.34 }),
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
  normals.forEach(([x, y, z], index) => {
    const normal = new THREE.Vector3(x, y, z).normalize();
    const patch = new THREE.Mesh(pentagonGeometry, pentagonMaterial);
    patch.position.copy(normal.clone().multiplyScalar(radius + 0.006));
    patch.quaternion.setFromUnitVectors(defaultNormal, normal);
    patch.rotateZ(index * 0.31);
    patch.castShadow = true;
    group.add(patch);
  });

  group.userData.ballTexture = ballTexture;
  return group;
}

function makePost(width: number, height: number, depth: number, position: THREE.Vector3) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.42 }),
  );
  mesh.position.copy(position);
  mesh.castShadow = true;
  return mesh;
}

export function createGoal() {
  const group = new THREE.Group();
  const postWidth = 0.08;
  const goalWidth = 4.25;
  const goalHeight = 2.15;
  const goalDepth = 1.2;

  group.add(makePost(postWidth, goalHeight, postWidth, new THREE.Vector3(-goalWidth / 2, goalHeight / 2, 0)));
  group.add(makePost(postWidth, goalHeight, postWidth, new THREE.Vector3(goalWidth / 2, goalHeight / 2, 0)));
  group.add(makePost(goalWidth + postWidth, postWidth, postWidth, new THREE.Vector3(0, goalHeight, 0)));
  group.add(makePost(postWidth, postWidth, goalDepth, new THREE.Vector3(-goalWidth / 2, 0.08, -goalDepth / 2)));
  group.add(makePost(postWidth, postWidth, goalDepth, new THREE.Vector3(goalWidth / 2, 0.08, -goalDepth / 2)));

  const netMaterial = new THREE.LineBasicMaterial({ color: "#dbeafe", transparent: true, opacity: 0.5 });
  const linePoints: number[] = [];
  const addLine = (from: THREE.Vector3, to: THREE.Vector3) => {
    linePoints.push(from.x, from.y, from.z, to.x, to.y, to.z);
  };

  for (let x = -goalWidth / 2; x <= goalWidth / 2 + 0.01; x += 0.35) {
    addLine(new THREE.Vector3(x, 0.08, -goalDepth), new THREE.Vector3(x, goalHeight, -goalDepth));
    addLine(new THREE.Vector3(x, goalHeight, 0), new THREE.Vector3(x, goalHeight, -goalDepth));
  }
  for (let y = 0.25; y <= goalHeight + 0.01; y += 0.28) {
    addLine(new THREE.Vector3(-goalWidth / 2, y, -goalDepth), new THREE.Vector3(goalWidth / 2, y, -goalDepth));
    addLine(new THREE.Vector3(-goalWidth / 2, y, 0), new THREE.Vector3(-goalWidth / 2, y, -goalDepth));
    addLine(new THREE.Vector3(goalWidth / 2, y, 0), new THREE.Vector3(goalWidth / 2, y, -goalDepth));
  }

  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePoints, 3));
  group.add(new THREE.LineSegments(netGeometry, netMaterial));
  group.position.set(0, -0.72, -6.2);
  return group;
}

export function createStands() {
  const group = new THREE.Group();
  const standWidth = 16;
  const rows = 8;
  const seatsPerRow = 38;
  const structureMaterial = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.68 });
  const seatMaterials = [
    new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.52 }),
    new THREE.MeshStandardMaterial({ color: "#10b981", roughness: 0.56 }),
    new THREE.MeshStandardMaterial({ color: "#38bdf8", roughness: 0.56 }),
    new THREE.MeshStandardMaterial({ color: "#94a3b8", roughness: 0.56 }),
  ];

  const base = new THREE.Mesh(new THREE.BoxGeometry(standWidth, 0.24, 1.9), structureMaterial);
  base.position.set(0, -0.36, -8.1);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  for (let row = 0; row < rows; row += 1) {
    const rowWidth = standWidth - row * 0.28;
    const platform = new THREE.Mesh(new THREE.BoxGeometry(rowWidth, 0.12, 0.24), structureMaterial);
    platform.position.set(0, -0.18 + row * 0.21, -7.32 - row * 0.2);
    platform.castShadow = true;
    platform.receiveShadow = true;
    group.add(platform);

    for (let seat = 0; seat < seatsPerRow; seat += 1) {
      const material = seatMaterials[(seat + row) % seatMaterials.length];
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.1, 0.13), material);
      const seatSpacing = rowWidth / seatsPerRow;
      chair.position.set(-rowWidth / 2 + seatSpacing * (seat + 0.5), -0.07 + row * 0.21, -7.18 - row * 0.2);
      chair.castShadow = true;
      group.add(chair);
    }
  }

  const railMaterial = new THREE.MeshStandardMaterial({ color: "#cbd5e1", roughness: 0.36 });
  const railTop = new THREE.Mesh(new THREE.BoxGeometry(standWidth + 0.3, 0.045, 0.045), railMaterial);
  railTop.position.set(0, 1.58, -8.88);
  group.add(railTop);
  for (let post = 0; post <= 10; post += 1) {
    const x = -standWidth / 2 + (standWidth / 10) * post;
    const railPost = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.55, 0.04), railMaterial);
    railPost.position.set(x, 0.82, -8.16);
    group.add(railPost);
  }

  group.position.set(0, -0.72, -0.62);
  return group;
}

export function createFieldLines() {
  const material = new THREE.LineBasicMaterial({ color: "#ecfdf5", transparent: true, opacity: 0.72 });
  const points: number[] = [];
  const addLine = (from: THREE.Vector3, to: THREE.Vector3) => {
    points.push(from.x, from.y, from.z, to.x, to.y, to.z);
  };
  const y = -0.715;
  const goalLineZ = -6.2;
  const nearLineZ = 3.2;
  const sideX = 7.1;
  const penaltyX = 3.25;
  const penaltyFrontZ = -3.1;
  const goalAreaX = 1.42;
  const goalAreaFrontZ = -5.08;
  const penaltySpotZ = -4.25;

  const addArc = (centerX: number, centerZ: number, radius: number, startAngle: number, endAngle: number, segments = 36) => {
    let previous = new THREE.Vector3(centerX + Math.cos(startAngle) * radius, y, centerZ + Math.sin(startAngle) * radius);
    for (let index = 1; index <= segments; index += 1) {
      const t = index / segments;
      const angle = startAngle + (endAngle - startAngle) * t;
      const current = new THREE.Vector3(centerX + Math.cos(angle) * radius, y, centerZ + Math.sin(angle) * radius);
      addLine(previous, current);
      previous = current;
    }
  };

  // Linea de fondo alineada con la porteria y limites laterales del campo visible.
  addLine(new THREE.Vector3(-sideX, y, goalLineZ), new THREE.Vector3(sideX, y, goalLineZ));
  addLine(new THREE.Vector3(-sideX, y, nearLineZ), new THREE.Vector3(sideX, y, nearLineZ));
  addLine(new THREE.Vector3(-sideX, y, goalLineZ), new THREE.Vector3(-sideX, y, nearLineZ));
  addLine(new THREE.Vector3(sideX, y, goalLineZ), new THREE.Vector3(sideX, y, nearLineZ));

  // Area grande frente al arco.
  addLine(new THREE.Vector3(-penaltyX, y, goalLineZ), new THREE.Vector3(-penaltyX, y, penaltyFrontZ));
  addLine(new THREE.Vector3(penaltyX, y, goalLineZ), new THREE.Vector3(penaltyX, y, penaltyFrontZ));
  addLine(new THREE.Vector3(-penaltyX, y, penaltyFrontZ), new THREE.Vector3(penaltyX, y, penaltyFrontZ));

  // Area chica.
  addLine(new THREE.Vector3(-goalAreaX, y, goalLineZ), new THREE.Vector3(-goalAreaX, y, goalAreaFrontZ));
  addLine(new THREE.Vector3(goalAreaX, y, goalLineZ), new THREE.Vector3(goalAreaX, y, goalAreaFrontZ));
  addLine(new THREE.Vector3(-goalAreaX, y, goalAreaFrontZ), new THREE.Vector3(goalAreaX, y, goalAreaFrontZ));

  // Punto y arco de tiro libre/penal frente al area.
  addArc(0, penaltySpotZ, 0.06, 0, Math.PI * 2, 20);
  addArc(0, penaltySpotZ, 1.08, 0.38, Math.PI - 0.38, 32);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, material);
}

