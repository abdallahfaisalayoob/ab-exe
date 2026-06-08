syms v1(t) v2(t)

equation1= diff(v1,t) + v1 ==2000
equation2= 2*diff(v2,t) + v2 ==1000

solutions = dsolve([equation1,equation2], [v1(0) ==0 , v2(0) ==0]);
v1_solution = solutions.v1
v2_solution = solutions.v2;
figure;

subplot(2,1,1)
fplot(v1_solution,[0,10], 'linewidth',2)
grid on;

xlabel('time(t)','FontWeight','bold')
ylabel('v_1(t)','FontWeight','bold')
title('solution to v_1', 'FontWeight','bold')

subplot(2,1,2)
fplot(v2_solution, [0,10], 'LineWidth',2)
grid on
xlabel("time(t)", 'FontWeight','bold')
ylabel('v_2(t)', 'FontWeight','bold')
title('solution to v_1')