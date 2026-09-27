export const STARTUP_SESSION_KEY = 'beezmovies-startup';

export const STARTUP_TIMING = {
  cinematicMs: 2800,
  briefMs: 720,
};

const previewEnabled = process.env.NODE_ENV !== 'production';

// Runs before paint. A failure leaves the attribute unset, so the homepage stays visible.
// The startup=1 query previews the sequence in local development only.
export const STARTUP_BOOT = `(function(){try{var standalone=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;var preview=${previewEnabled ? 'true' : 'false'}&&/(?:^|[?&])startup=1(?:&|$)/.test(window.location.search);if(!standalone&&!preview)return;var reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;var seen=false;if(!preview){try{seen=window.sessionStorage.getItem(${JSON.stringify(STARTUP_SESSION_KEY)})==="seen";}catch(e){}}document.documentElement.dataset.startup=reduced||seen?"brief":"cinematic";}catch(e){}})();`;
