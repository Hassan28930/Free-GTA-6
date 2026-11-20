/**
 * Centralized Google AdSense Configuration
 *
 * Ads remain safely disabled until:
 * 1. `enabled` is set to `true`
 * 2. A valid Google AdSense `publisherId` ("ca-pub-XXXXXXXXXXXXXXXX") is provided
 * 3. Each enabled position has its own valid numeric `slotId` from AdSense
 */
window.ADSENSE_CONFIG = {
  // Master switch to enable or disable all Google AdSense placements
  enabled: false,

  // Your AdSense Publisher ID (format: "ca-pub-1234567890123456")
  publisherId: '',

  // Minimum viewport width (px) required to display left and right sidebars
  sidebarBreakpointPx: 1340,

  // Individual placement controls and AdSense unit slot IDs
  positions: {
    top: {
      enabled: true,
      slotId: '',
      format: 'auto',
      fullWidthResponsive: true,
    },
    bottom: {
      enabled: true,
      slotId: '',
      format: 'auto',
      fullWidthResponsive: true,
    },
    left: {
      enabled: true,
      slotId: '',
      format: 'auto',
      fullWidthResponsive: false,
    },
    right: {
      enabled: true,
      slotId: '',
      format: 'auto',
      fullWidthResponsive: false,
    },
  },
};
