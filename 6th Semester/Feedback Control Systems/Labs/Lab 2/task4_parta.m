% Task 4
syms y(t)
Dy = diff(y,t);
D2y = diff(y,t,2);
eq = D2y + 5*Dy + 4*y == 2*exp(-2*t);
f = dsolve(eq, y(0)==0, Dy(0)==0);
xlabel("Time");
ylabel("amplitude");
title("diff equation")
ezplot(f, [-10 10])
grid on

