// jest.config.js
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  globalSetup: './testConfig/globalSetup.ts',
  globalTeardown: './testConfig/globalTeardown.ts',
  setupFilesAfterEnv: ['./testConfig/setupFile.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};