const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniMeet', {
  lessonStarted: (payload) => ipcRenderer.send('lesson-started', payload),
  lessonEnded: () => ipcRenderer.send('lesson-ended'),
  sendToolbarState: (payload) => ipcRenderer.send('toolbar-state', payload),
  setStudentLink: (link) => ipcRenderer.send('student-link', link),
  onCommand: (handler) => ipcRenderer.on('toolbar-command', (_event, command) => handler(command)),
  onToolbarState: (handler) => ipcRenderer.on('toolbar-state', (_event, state) => handler(state)),
  toolbarCommand: (command) => ipcRenderer.send('toolbar-command-from-toolbar', command),
  onAnnotationState: (handler) => ipcRenderer.on('annotation-state', (_event, state) => handler(state)),
  annotationToolCommand: (command) => ipcRenderer.send('annotation-command-from-tools', command),
  onAnnotationCommand: (handler) => ipcRenderer.on('annotation-command', (_event, command) => handler(command)),
  closeAnnotation: () => ipcRenderer.send('annotation-close'),
  closeApp: () => ipcRenderer.send('close-app'),
  minimize: () => ipcRenderer.send('minimize-media'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  remoteScreenActive: (active) => ipcRenderer.send('remote-screen-active', Boolean(active)),
  getAppInfo: () => ipcRenderer.invoke('get-app-info')
});
