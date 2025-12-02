/// <reference types="vite/client" />

declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '/icon.svg' {
  const content: string;
  export default content;
}
