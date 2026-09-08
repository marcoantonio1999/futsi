import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createStands, createGoal, createFieldLines, createSoccerBall, PITCH } from '../src/components/landing/FutsiLandingSceneObjects.ts';

// These tests inspect geometry without creating a browser or GPU context.
globalThis.document = { createElement: () => ({ getContext: () => null }) };

test('detailed stadium stays within its geometry and draw-call budget', () => {
  const scene = new THREE.Group();
  scene.add(createStands(), createGoal(), createFieldLines(), createSoccerBall());
  let draws = 0, triangles = 0, shadowCasters = 0;
  scene.traverse(object => {
    if (!(object.isMesh || object.isLineSegments)) return;
    draws++;
    shadowCasters += Number(object.castShadow);
    if (object.isMesh) triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
  });
  assert.ok(draws <= 10, `${draws} draw calls; keep repeated seats/posts instanced`);
  assert.ok(triangles < 15000, `${triangles} triangles`);
  assert.ok(shadowCasters <= 3, 'distant seats must not add per-frame shadow passes');
});

test('pitch paint faces upwards and stays above the grass without floating', () => {
  const lines = createFieldLines();
  const position = lines.geometry.attributes.position;
  const normals = lines.geometry.attributes.normal;
  for (let index = 0; index < position.count; index++) {
    assert.ok(Math.abs(position.getY(index) - (PITCH.groundY + 0.009)) < 0.00001);
    assert.ok(normals.getY(index) > 0.999);
  }
  lines.geometry.computeBoundingBox();
  const bounds = lines.geometry.boundingBox;
  assert.ok(bounds.min.z <= PITCH.goalZ && bounds.max.z >= PITCH.goalZ + PITCH.length);
  assert.ok(bounds.min.x < -PITCH.width / 2 && bounds.max.x > PITCH.width / 2);
});

test('hundreds of seats have shared geometry, backrests and fixed transforms', () => {
  const stands = createStands();
  const seats = stands.children.find(object => object.isInstancedMesh && object.count > 300);
  assert.ok(seats, 'seats should share a single draw call');
  seats.geometry.computeBoundingBox();
  assert.ok(seats.geometry.boundingBox.max.y >= 0.37, 'seat backs should be visible above cushions');
  assert.equal(seats.instanceMatrix.usage, THREE.StaticDrawUsage);
  assert.ok(seats.instanceColor);
});
