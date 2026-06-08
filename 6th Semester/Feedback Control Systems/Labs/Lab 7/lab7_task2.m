F = tf([1],  [1, 0, 1]);
G = tf([4],  [1, 0, 4]);
H = tf([9],  [1, 0, 9]);

t = 0:0.01:10;

% a) Pole-Zero Map
figure;
pzmap(F, G, H);
legend('F (wn=1)', 'G (wn=2)', 'H (wn=3)');
title('Pole-Zero Map ');
grid on;

% b) Impulse Response
figure;
impulse(F,t); hold on;
impulse(G,t);
impulse(H,t);
legend('F (wn=1)', 'G (wn=2)', 'H (wn=3)');
title('Impulse Response '); 
grid on; 
hold off;

% Step Response
figure;
step(F,t);
hold on;
step(G,t);
step(H,t);
legend('F (wn=1)', 'G (wn=2)', 'H (wn=3)');
title('Step Response '); 
grid on; 
hold off;

