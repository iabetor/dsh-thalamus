/** CSS module declarations for the browser bundle (see tsdown cssChannels). */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
