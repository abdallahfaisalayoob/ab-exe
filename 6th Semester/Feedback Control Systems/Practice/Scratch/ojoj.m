
syms theta(t)

Jm = 200;
Ra = 10;
Va = 10;
Kt = 12;
Ke = 12;
b  = 10;

equation = Jm*diff(theta,t,2) + (b + (Kt*Ke)/Ra)*diff(theta,t) == (Kt/Ra)*Va;

Dtheta = diff(theta,t);
conds = [theta(0)==0, Dtheta(0)==0];

theta_solution = simplify(dsolve(equation, conds))

figure
fplot(theta_solution, [0 50], 'LineWidth', 2)
grid on
xlabel('time (t)','FontWeight','bold')
ylabel('\theta_m(t)','FontWeight','bold')
title('Task 3(b): Motor Position Response', 'FontWeight','bold')
