s = tf('s');
G = 5/(s^2 + 3*s + 5);
figure;
step(G);
stepinfo(G)
legend('G');
grid on;