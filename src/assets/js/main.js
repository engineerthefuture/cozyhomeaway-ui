/*
	Highlights by HTML5 UP
	html5up.net | @ajlkn
	Free for personal and commercial use under the CCA 3.0 license (html5up.net/license)
*/

(function($) {

    var $window = $(window),
        $body = $('body'),
        $html = $('html');

    // Breakpoints.
    breakpoints({
        large: ['981px', '1680px'],
        medium: ['737px', '980px'],
        small: ['481px', '736px'],
        xsmall: [null, '480px']
    });

    // Play initial animations on page load.
    $window.on('load', function() {
        window.setTimeout(function() {
            $body.removeClass('is-preload');
        }, 100);
    });

    // Touch mode.
    if (browser.mobile) {

        var $wrapper;

        // Create wrapper.
        $body.wrapInner('<div id="wrapper" />');
        $wrapper = $('#wrapper');

        // Hack: iOS vh bug.
        if (browser.os == 'ios')
            $wrapper
            .css('margin-top', -25)
            .css('padding-bottom', 25);

        // Pass scroll event to window.
        $wrapper.on('scroll', function() {
            $window.trigger('scroll');
        });

        // Scrolly.
        $window.on('load.hl_scrolly', function() {

            $('.scrolly').scrolly({
                speed: 1500,
                parent: $wrapper,
                pollOnce: true
            });

            $window.off('load.hl_scrolly');

        });

        // Enable touch mode.
        $html.addClass('is-touch');

    } else {

        // Scrolly.
        $('.scrolly').scrolly({
            speed: 1500
        });

    }

    // Header.
    var $header = $('#header'),
        $headerTitle = $header.find('header'),
        $headerContainer = $header.find('.container');

    // Make title fixed.
    if (!browser.mobile) {

        $window.on('load.hl_headerTitle', function() {

            breakpoints.on('>medium', function() {

                $headerTitle
                    .css('position', 'fixed')
                    .css('height', 'auto')
                    .css('top', '50%')
                    .css('left', '0')
                    .css('width', '100%')
                    .css('margin-top', ($headerTitle.outerHeight() / -2));

            });

            breakpoints.on('<=medium', function() {

                $headerTitle
                    .css('position', '')
                    .css('height', '')
                    .css('top', '')
                    .css('left', '')
                    .css('width', '')
                    .css('margin-top', '');

            });

            $window.off('load.hl_headerTitle');

        });

    }

    // Scrollex.
    breakpoints.on('>small', function() {
        $header.scrollex({
            terminate: function() {

                $headerTitle.css('opacity', '');

            },
            scroll: function(progress) {

                // Fade out title as user scrolls down.
                if (progress > 0.5)
                    x = 1 - progress;
                else
                    x = progress;

                $headerTitle.css('opacity', Math.max(0, Math.min(1, x * 2)));

            }
        });
    });

    breakpoints.on('<=small', function() {

        $header.unscrollex();

    });

    // Main sections.
    $('.main').each(function() {

        var $this = $(this),
            $primaryImg = $this.find('.image.primary > img'),
            $bg,
            options;

        // No primary image? Bail.
        if ($primaryImg.length == 0)
            return;

        // Create bg and append it to body.
        $bg = $('<div class="main-bg" id="' + $this.attr('id') + '-bg"></div>')
            .css('background-image', (
                'url("assets/css/images/overlay.png"), url("' + $primaryImg.attr('src') + '")'
            ))
            .appendTo($body);

        // Scrollex.
        $this.scrollex({
            mode: 'middle',
            delay: 200,
            top: '-10vh',
            bottom: '-10vh',
            init: function() { $bg.removeClass('active'); },
            enter: function() { $bg.addClass('active'); },
            leave: function() { $bg.removeClass('active'); }
        });

    });

    // Custom JavaScript for Cozy Home Away website

    // Update copyright year automatically
    $(document).ready(function() {
        var copyrightElement = document.getElementById('copyright-year');
        if (copyrightElement) {
            copyrightElement.textContent = new Date().getFullYear();
        }
    });

    // Sync Airbnb image with VRBO card
    function syncAirbnbImageToVrbo() {
        setTimeout(function() {
            var airbnbFrame = document.querySelector('.airbnb-embed-frame iframe');
            if (airbnbFrame) {
                try {
                    // Try to get the image from Airbnb embed
                    var airbnbDoc = airbnbFrame.contentDocument || airbnbFrame.contentWindow.document;
                    var airbnbImg = airbnbDoc.querySelector('img[src*="muscache"]');

                    if (airbnbImg && airbnbImg.src) {
                        var vrboImageDiv = document.getElementById('vrbo-image');
                        if (vrboImageDiv) {
                            vrboImageDiv.style.backgroundImage = 'url("' + airbnbImg.src + '")';
                        }
                    }
                } catch (e) {
                    // Cross-origin restrictions prevent access, use fallback
                    console.log('Using fallback image for VRBO card');
                }
            }
        }, 3000); // Wait for Airbnb embed to load
    }

    // Try to sync the image when page loads
    $window.on('load', syncAirbnbImageToVrbo);

    // Also try after a delay for Airbnb embed
    setTimeout(syncAirbnbImageToVrbo, 5000);

})(jQuery);