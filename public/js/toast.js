// public/js/toast.js
(function() {
    function ensureBox() {
        let box = document.querySelector('.toast-container');
        if (!box) {
            box = document.createElement('div');
            box.className = 'toast-container';
            document.body.appendChild(box);
        }
        return box;
    }
    window.toast = function(msg, type = 'info', ms = 3500) {
        const box = ensureBox();
        const t = document.createElement('div');
        t.className = `toast toast-${type}`;
        t.textContent = msg;
        box.appendChild(t);
        setTimeout(() => {
            t.style.opacity = '0';
            t.style.transform = 'translateX(20px)';
            t.style.transition = 'all .25s';
            setTimeout(() => t.remove(), 260);
        }, ms);
    };
})();