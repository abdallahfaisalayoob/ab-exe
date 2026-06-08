t = 0:0.01:10;
% Task 2 – Part 2
F = tf([1],  [1, 0,  1]);   % poles at ±j
G = tf([2],  [1, 2,  2]);   % poles at -1±j
H = tf([5],  [1, 4,  5]);   % poles at -2±j

% a) Pole-Zero Map
figure;
pzmap(F, G, H);
legend('F (sigma=0)', 'G (sigma=1)', 'H (sigma=2)');
title('Pole-Zero Map – Part 2 (Constant wd=1)');
grid on;

% b) Impulse Response
figure;
impulse(F,t); hold on;
impulse(G,t);
impulse(H,t);
legend('F (sigma=0)', 'G (sigma=1)', 'H (sigma=2)');
title('Impulse Response – Part 2'); grid on; hold off;

% Step Response
figure;
step(F,t); hold on;
step(G,t);
step(H,t);
legend('F (sigma=0)', 'G (sigma=1)', 'H (sigma=2)');
title('Step Response – Part 2'); grid on; hold off;
