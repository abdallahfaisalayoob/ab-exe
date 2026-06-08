% Constant wn = 3

F = tf([9],[1 1.2 9]);
G = tf([9],[1 3 9]);
H = tf([9],[1 4.8 9]);

% Pole-Zero Map
figure;
pzmap(F,G,H);
legend('F','G','H');
title('Pole-Zero Map (Constant wn)');
grid on;

% Impulse Response
figure;
impulse(F); hold on;
impulse(G);
impulse(H);
legend('F','G','H');
title('Impulse Response (Constant wn)');
grid on;
hold off;

% Step Response
figure;
step(F); hold on;
step(G);
step(H);
legend('F','G','H');
title('Step Response (Constant wn)');
grid on;
hold off;

% Step Information
disp('Step Info F'); stepinfo(F)
disp('Step Info G'); stepinfo(G)
disp('Step Info H'); stepinfo(H)