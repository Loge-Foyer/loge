// `expo start` writes expo-env.d.ts with this reference, but that file is
// generated and ignored by git. Referencing Expo's types here keeps a fresh
// checkout type-checking — TypeScript 6 checks side-effect imports such as
// the web reset stylesheet in the root layout.
/// <reference types="expo/types" />
