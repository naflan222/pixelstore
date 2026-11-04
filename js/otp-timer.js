(function () {
    'use strict';

    var DURATION = 60; // seconds
    var count = DURATION;
    var counter = null;

    function render() {
        var el = document.getElementById('resendOTP');
        if (!el) return;
        if (count <= 0) {
            el.innerHTML = '<a class="resendOTP" href="#">Resend OTP</a>';
        } else {
            el.innerHTML = 'Wait ' + count + ' secs';
        }
    }

    function start() {
        count = DURATION;
        if (counter) clearInterval(counter);
        counter = setInterval(function () {
            count = count - 1;
            if (count <= 0) {
                clearInterval(counter);
                counter = null;
            }
            render();
        }, 1000);
        render();
    }

    // Exposed so api-client.js can restart the countdown after a resend.
    window.__restartOtpTimer = start;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // Auto-focus first OTP box and auto-advance while typing.
    document.addEventListener('input', function (e) {
        if (!e.target.classList || !e.target.classList.contains('single-otp-input')) return;
        if (e.target.value.length >= e.target.maxLength) {
            var next = e.target.nextElementSibling;
            if (next && next.classList.contains('single-otp-input')) next.focus();
        }
    });
    document.addEventListener('keydown', function (e) {
        if (!e.target.classList || !e.target.classList.contains('single-otp-input')) return;
        if (e.key === 'Backspace' && !e.target.value && e.target.previousElementSibling) {
            var prev = e.target.previousElementSibling;
            if (prev.classList.contains('single-otp-input')) {
                prev.focus();
                prev.value = '';
            }
        }
        // Allow only digits
        if (/[^\d]/.test(e.key) && e.key.length === 1) e.preventDefault();
    });

    // Mobile: pasting the whole code into the first box fans it out.
    document.addEventListener('paste', function (e) {
        if (!e.target.classList || !e.target.classList.contains('single-otp-input')) return;
        var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (!text) return;
        e.preventDefault();
        var boxes = Array.prototype.slice.call(
            document.querySelectorAll('.single-otp-input')
        );
        boxes.forEach(function (b) { b.value = ''; });
        for (var i = 0; i < boxes.length && i < text.length; i++) boxes[i].value = text[i];
        var focusIdx = Math.min(text.length, boxes.length) - 1;
        if (boxes[focusIdx]) boxes[focusIdx].focus();
    });

})();
