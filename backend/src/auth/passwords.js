import { hash, verify, Algorithm } from '@node-rs/argon2';
import { PASSWORD_HASH_PARAMS } from './constants.js';

const options = {
  ...PASSWORD_HASH_PARAMS,
  algorithm: Algorithm.Argon2id,
};

let dummyHash;

export async function hashPassword(password) {
  return hash(password, options);
}

export async function verifyPassword(passwordHash, password) {
  return verify(passwordHash, password);
}

export async function verifyMissingPassword(password) {
  if (!dummyHash) {
    dummyHash = await hashPassword('beezmovies-missing-account');
  }
  await verify(dummyHash, password);
}
