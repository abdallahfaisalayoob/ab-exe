
F = tf([1], [1, 0, 1]);
G = tf([1], [1, 1, 1]);
H = tf([1], [1, 2, 1]);

figure;
pzmap(F, G, H);
legend('F (Undamped)', 'G (Underdamped)', 'H (Critically Damped)');
title('PZ Map – RLC Circuit');
grid on;
