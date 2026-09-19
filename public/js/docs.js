// Smooth scroll and active nav highlighting
document.querySelectorAll('.sidebar-nav a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

// Update active nav on scroll
const sections = document.querySelectorAll('.doc-section');
const navLinks = document.querySelectorAll('.sidebar-nav a');

const observerOptions = {
    root: null,
    rootMargin: '-20% 0px -80% 0px',
    threshold: 0
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const id = entry.target.getAttribute('id');
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === `#${id}`) {
                    link.classList.add('active');
                }
            });
        }
    });
}, observerOptions);

sections.forEach(section => observer.observe(section));

// Mobile sidebar toggle functionality
const sidebarToggle = document.querySelector('.sidebar-toggle');
const sidebarContent = document.querySelector('.sidebar-content');

if (sidebarToggle && sidebarContent) {
    sidebarToggle.addEventListener('click', () => {
        const isExpanded = sidebarToggle.getAttribute('aria-expanded') === 'true';
        sidebarToggle.setAttribute('aria-expanded', !isExpanded);
        sidebarContent.classList.toggle('expanded');
    });
}

console.log('✅ Documentation page loaded');
