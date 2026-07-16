/* @ds-bundle: {"name":"ReadyRoute","globalName":"ReadyRoute","components":[],"tokensOnly":true} */
/*
 * ReadyRoute is a tokens + fonts design system.
 *
 * ReadyRoute ships as an application, not a component library — it has no
 * standalone, prop-driven React components to import. Its design language (the
 * dark surface + status-color palette, IBM Plex type, radii, shadows, and the
 * compiled utility/component classes) is delivered entirely through styles.css.
 *
 * This bundle therefore exposes no exports; it exists so the design runtime has
 * a window.<globalName> to bind, consistent with the rest of the format.
 */
(function (root) {
  root.ReadyRoute = root.ReadyRoute || {};
})(typeof window !== "undefined" ? window : globalThis);
