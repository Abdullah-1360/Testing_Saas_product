module.exports = {
  displayName: 'WP-AutoHealer',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/test/**/*.spec.ts',
    '<rootDir>/test/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.interface.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.entity.ts',
    '!src/main.ts',
    '!src/**/*.module.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/auth/(.*)$': '<rootDir>/src/auth/$1',
    '^@/users/(.*)$': '<rootDir>/src/users/$1',
    '^@/servers/(.*)$': '<rootDir>/src/servers/$1',
    '^@/sites/(.*)$': '<rootDir>/src/sites/$1',
    '^@/incidents/(.*)$': '<rootDir>/src/incidents/$1',
    '^@/jobs/(.*)$': '<rootDir>/src/jobs/$1',
    '^@/ssh/(.*)$': '<rootDir>/src/ssh/$1',
    '^@/evidence/(.*)$': '<rootDir>/src/evidence/$1',
    '^@/backup/(.*)$': '<rootDir>/src/backup/$1',
    '^@/verification/(.*)$': '<rootDir>/src/verification/$1',
    '^@/audit/(.*)$': '<rootDir>/src/audit/$1',
    '^@/common/(.*)$': '<rootDir>/src/common/$1',
    '^@/config/(.*)$': '<rootDir>/src/config/$1',
    '^@/database/(.*)$': '<rootDir>/src/database/$1'
  },
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest'
  },
  testTimeout: 30000,
  verbose: true,
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  }
};