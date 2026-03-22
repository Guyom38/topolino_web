document.addEventListener('DOMContentLoaded', () => {
    // Révélation au scroll
    function reveal() {
        var reveals = document.querySelectorAll('.reveal');
        for (var i = 0; i < reveals.length; i++) {
            var windowHeight = window.innerHeight;
            var elementTop = reveals[i].getBoundingClientRect().top;
            var elementVisible = 150;
            if (elementTop < windowHeight - elementVisible) {
                reveals[i].classList.add('active');
            }
        }
    }
    window.addEventListener('scroll', reveal);
    reveal(); // Trigger on load

    // Effet Parallaxe très basique sur les images
    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        const parallaxElements = document.querySelectorAll('.parallax-img');
        parallaxElements.forEach(el => {
            const speed = el.dataset.speed || 0.2;
            el.style.transform = `translateY(${scrolled * speed}px)`;
        });
    });
});
