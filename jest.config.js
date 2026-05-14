/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/electron", "<rootDir>/scripts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@components/(.*)$": "<rootDir>/src/components/$1",
    "^@hooks/(.*)$": "<rootDir>/src/hooks/$1",
    "^@utils/(.*)$": "<rootDir>/src/utils/$1",
    "^@styles/(.*)$": "<rootDir>/src/styles/$1",
    "^@pages/(.*)$": "<rootDir>/src/pages/$1",
    "^@contexts/(.*)$": "<rootDir>/src/contexts/$1",
    "\\.(css|less|scss|sass)$": "<rootDir>/src/__mocks__/styleMock.js",
    "^p-limit$": "<rootDir>/src/__mocks__/p-limit.js",
  },
  setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
  testMatch: ["**/__tests__/**/*.test.{ts,tsx,js}", "**/*.test.{ts,tsx,js}"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          strict: true,
          moduleResolution: "node10",
          ignoreDeprecations: "6.0",
        },
      },
    ],
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(p-limit|yocto-queue|lucide-react|framer-motion|@radix-ui|diff)/)",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/main.tsx",
    "!src/__mocks__/**",
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
    "./src/services/**/*.ts": {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
    "./electron/services/**/*.ts": {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
};

module.exports = config;
