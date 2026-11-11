// Mock the vscode module for Jest tests (ESM)
import { jest } from '@jest/globals';

export const window = {
  createFileSystemWatcher: jest.fn(() => ({
    onDidCreate: jest.fn(),
    onDidChange: jest.fn(),
    onDidDelete: jest.fn(),
    dispose: jest.fn(),
  })),
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showInputBox: jest.fn(),
  showQuickPick: jest.fn(),
  showOpenDialog: jest.fn(),
  createStatusBarItem: jest.fn(() => ({
    text: '',
    show: jest.fn(),
    hide: jest.fn(),
  })),
  openTextDocument: jest.fn(),
  showTextDocument: jest.fn(),
  createWebviewPanel: jest.fn(),
  createTreeView: jest.fn(),
};

export const workspace = {
  createFileSystemWatcher: jest.fn(() => ({
    onDidCreate: jest.fn(),
    onDidChange: jest.fn(),
    onDidDelete: jest.fn(),
    dispose: jest.fn(),
  })),
  fs: {
    readFile: jest.fn(),
  },
  getConfiguration: jest.fn(() => ({
    get: jest.fn(),
    update: jest.fn(),
  })),
};

export class RelativePattern {
  constructor(public base: string, public pattern: string) {}
}

export const commands = {
  registerCommand: jest.fn(),
};

export const StatusBarAlignment = {
  Right: 2,
};

export class ThemeIcon {
  constructor(public id: string) {}
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];

  get event() {
    return (listener: (e: T) => void) => {
      this._listeners.push(listener);
      return { dispose: () => {} };
    };
  }

  fire(_event?: T) {}
}

export const ViewColumn = {
  Two: 2,
};

export const Uri = {
  joinPath: jest.fn(),
  fromFileSystemPath: jest.fn(),
};
