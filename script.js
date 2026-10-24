const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

document.querySelectorAll('[data-tally-placeholder]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (link.getAttribute('href') === '#') {
      event.preventDefault();
      alert('Your Tally order link will be connected here next.');
    }
  });
});


const proofData = {
  beauty: {
    kicker: 'BEAUTY / SKINCARE',
    title: 'Problem → tension → reveal → payoff',
    text: 'This slot will hold a real short-form video created by the Make You Stop engine. The viewer should feel the problem, open a question, and stay to see the visual payoff.'
  },
  creator: {
    kicker: 'CREATORS',
    title: 'Hooks that open a loop',
    text: 'This slot will show real engine-produced creator hooks and, where useful, a finished short-form example built from one of them.'
  },
  saas: {
    kicker: 'SAAS / TECH',
    title: 'Make the feature matter',
    text: 'This slot will show a real engine-produced feature walkthrough that starts with a human frustration, then reveals the software feature as the payoff.'
  }
};

const modal = document.getElementById('proof-modal');
const modalKicker = document.getElementById('proof-modal-kicker');
const modalTitle = document.getElementById('proof-modal-title');
const modalText = document.getElementById('proof-modal-text');

document.querySelectorAll('[data-proof]').forEach((button) => {
  button.addEventListener('click', () => {
    const data = proofData[button.dataset.proof];
    if (!data || !modal) return;
    modalKicker.textContent = data.kicker;
    modalTitle.textContent = data.title;
    modalText.textContent = data.text;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  });
});

document.querySelectorAll('[data-close-proof]').forEach((button) => {
  button.addEventListener('click', () => {
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal?.classList.contains('open')) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }
});
