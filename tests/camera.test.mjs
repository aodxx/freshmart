import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraErrorDetails, isEmbeddedBrowser } from '../js/camera.js';

test('detects LINE and social in-app browsers', () => {
  assert.equal(isEmbeddedBrowser('Mozilla/5.0 Line/14.2.1'), true);
  assert.equal(isEmbeddedBrowser('Mozilla/5.0 FBAN/FBIOS'), true);
  assert.equal(isEmbeddedBrowser('Mozilla/5.0 Chrome/138.0.0.0 Mobile'), false);
});
test('explains blocked camera permission', () => {
  const result = cameraErrorDetails(
    { name: 'NotAllowedError', message: 'Permission denied' },
    { isSecureContext: true, hasMediaDevices: true, userAgent: 'Chrome Mobile' }
  );
  assert.equal(result.code, 'permission_denied');
  assert.match(result.message, /อนุญาต/);
});

test('prioritizes secure-context and browser capability failures', () => {
  assert.equal(cameraErrorDetails(new Error('failed'), {
    isSecureContext: false,
    hasMediaDevices: true
  }).code, 'insecure_context');
  assert.equal(cameraErrorDetails(new Error('failed'), {
    isSecureContext: true,
    hasMediaDevices: false
  }).code, 'unsupported');
});

test('explains busy and missing cameras', () => {
  assert.equal(cameraErrorDetails({ name: 'NotReadableError' }, {
    isSecureContext: true,
    hasMediaDevices: true
  }).code, 'camera_busy');
  assert.equal(cameraErrorDetails({ name: 'NotFoundError' }, {
    isSecureContext: true,
    hasMediaDevices: true
  }).code, 'camera_not_found');
});
