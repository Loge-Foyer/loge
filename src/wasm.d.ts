// Metro serves a .wasm file as an asset (metro.config.js): importing one gives
// the asset's id, which expo-asset turns into a URL.
declare module '*.wasm' {
  const asset: number;
  export default asset;
}
