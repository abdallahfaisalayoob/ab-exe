s = tf('s');

G1 = 2/s;
G2 = 4/s;
G4 = 1/s;
G6 = 1/s;

G_parallel = parallel(G1, G2); 

G_forward = series(G_parallel, G4);
sys_closed_loop = -feedback(G_forward, G6);  % as it is a feedback, feedabck gets a minux sign.

disp('The Closed-Loop Transfer Function is:')
tf(sys_closed_loop)

figure;

subplot(2,1,1);
step(sys_closed_loop);
grid on;
title('Step Response');
xlim([20 100]);

subplot(2,1,2);
impulse(sys_closed_loop);
grid on;
title('Impulse Response');
xlim([20 100]);