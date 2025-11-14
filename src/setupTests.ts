import '@testing-library/jest-dom';

// Mock electron modules for testing
jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  contextBridge: {
    exposeInMainWorld: jest.fn(),
  },
}));

// Mock window.electron for IPC (only in renderer/browser environment)
// Skip this for electron main process tests
if (typeof window !== 'undefined') {
  global.window = Object.create(window);
  Object.defineProperty(window, 'electron', {
    value: {
      ipcRenderer: {
        invoke: jest.fn(),
        on: jest.fn(),
        send: jest.fn(),
        removeAllListeners: jest.fn(),
      },
    },
    writable: true,
  });
}

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock performance.now() for timing tests
global.performance = {
  ...performance,
  now: jest.fn(() => Date.now()),
};
