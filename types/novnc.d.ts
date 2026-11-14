// @types/novnc__novnc still describes the old lib/ entry points; noVNC 1.7
// exports RFB as the package root's default export.
declare module "@novnc/novnc" {
  import RFB from "@novnc/novnc/lib/rfb"
  export default RFB
}
