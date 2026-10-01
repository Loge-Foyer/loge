# @sc/player-kit

The React half of the player contract: `PlayerView`, the component that draws
a controller's picture, and `PlayerPlugin`, what a player plugin exports — its
manifest and role from `@sc/api`, and its view.

`@sc/api` imports nothing, so it cannot say what a React component is. The
controller, `MediaPlayer`, is there, framework-free; the view is here. The
controls on top of the picture belong to the app, the same for every engine.

Peers: `@sc/api`, `react`, `react-native`. Only a player plugin and the app's
composition root import it.
