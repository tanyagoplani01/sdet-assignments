/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],   // tells Jest to look in the tests folder
  moduleFileExtensions: ['ts', 'js'],
};
