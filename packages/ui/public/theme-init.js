// Applied before first paint so a dark-mode user never sees a white flash.
;(function () {
  // Both directions are stamped: a stored 'light' has to beat a dark OS,
  // or the media query below overrides the viewer's own choice.
  var t = localStorage.getItem('rd_theme')
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t)
  // An unknown name matches no rule, which leaves the default accent.
  var a = localStorage.getItem('rd_accent')
  if (a && /^[a-z]+$/.test(a)) document.documentElement.setAttribute('data-accent', a)
})()
