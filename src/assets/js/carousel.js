fetch('reviews.html')
    .then(function (r) {
        if (!r.ok) { throw new Error('reviews.html not found: ' + r.status); }
        return r.text();
    })
    .then(function (html) {
        document.getElementById('reviews-placeholder').innerHTML = html;

        var slides = document.querySelectorAll('.review-slide');
        var dots   = document.querySelectorAll('.carousel-dot');
        if (!slides.length) { return; }
        var current = 0;
        var timer;

        // Condensed paginator: show a 7-dot sliding window when there are many reviews.
        var WINDOW = 7;          // total visible dots
        var CONDENSED_AT = 10;   // activate condensed mode above this count
        var condensed = slides.length > CONDENSED_AT;

        // Size classes applied to each dot by its distance from the active dot.
        // Index 0 = active, 1 = ±1 away, 2 = ±2 away, 3 = edge (outermost shown).
        var sizeClass = ['dot-sz-0', 'dot-sz-1', 'dot-sz-2', 'dot-sz-3'];

        function updateDots() {
            if (!condensed) {
                // Simple mode: just toggle .active class.
                dots.forEach(function (d, i) {
                    d.classList.toggle('active', i === current);
                });
                return;
            }

            // Window centre: keep active dot in the middle, clamped to edges.
            var half   = Math.floor(WINDOW / 2);
            var winStart = Math.max(0, Math.min(current - half, slides.length - WINDOW));
            var winEnd   = winStart + WINDOW - 1;

            dots.forEach(function (d, i) {
                var visible = (i >= winStart && i <= winEnd);
                d.classList.toggle('dot-hidden', !visible);

                // Remove all size classes then apply the right one.
                sizeClass.forEach(function (c) { d.classList.remove(c); });
                if (visible) {
                    var dist = Math.abs(i - current);
                    // Map distance to size tier (cap at outermost tier).
                    var tier = Math.min(dist, sizeClass.length - 1);
                    // Edge dots (first/last of window) get the smallest size.
                    if (i === winStart || i === winEnd) { tier = sizeClass.length - 1; }
                    d.classList.add(sizeClass[tier]);
                }

                d.classList.toggle('active', i === current);
            });
        }

        function show(index) {
            slides[current].classList.remove('active');
            current = (index + slides.length) % slides.length;
            slides[current].classList.add('active');
            updateDots();
        }

        function next() { show(current + 1); }

        function startTimer() { timer = setInterval(next, 6000); }
        function resetTimer() { clearInterval(timer); startTimer(); }

        dots.forEach(function (dot, i) {
            dot.addEventListener('click', function () { show(i); resetTimer(); });
        });

        updateDots();
        startTimer();
    })
    .catch(function (err) { console.error('Carousel failed to load:', err); });
