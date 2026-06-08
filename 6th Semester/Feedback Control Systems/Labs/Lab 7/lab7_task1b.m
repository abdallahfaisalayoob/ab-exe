t = 0:0.01:10;

figure;
impulse(F,t);
hold on;
impulse(G,t);
impulse(H,t);

legend('F (Undamped)','G (Underdamped)','H (Critically Damped)');
title('Impulse Response – RLC Circuit');
xlabel('Time (s)');
ylabel('Amplitude');
grid on;
hold off;