fetch('reviews.html')
    .then(function (r) { return r.text(); })
    .then(function (html) {
        document.getElementById('reviews-placeholder').innerHTML = html;

        var slides = document.querySelectorAll('.review-slide');
        var dots = document.querySelectorAll('.carousel-dot');
        var current = 0;
        var timer;

        function show(index) {
            slides[current].classList.remove('active');
            dots[current].classList.remove('active');
            current = (index + slides.length) % slides.length;
            slides[current].classList.add('active');
            dots[current].classList.add('active');
        }

        function next() { show(current + 1); }

        function startTimer() { timer = setInterval(next, 6000); }
        function resetTimer() { clearInterval(timer); startTimer(); }

        dots.forEach(function (dot, i) {
            dot.addEventListener('click', function () { show(i); resetTimer(); });
        });

        startTimer();
    });
