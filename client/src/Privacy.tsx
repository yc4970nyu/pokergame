import { navigate } from './router';
import { BackButton } from './ui';

/** /privacy — 隐私说明（Google 登录要求有这个页面） */
export function Privacy() {
  return (
    <main className="page">
      <div className="page-inner narrow">
        <header className="page-head">
          <BackButton onClick={() => navigate('/')} />
          <div className="page-title"><h1>隐私说明</h1><p>Privacy Policy</p></div>
        </header>
        <article className="pcard legal">
          <p>大老二是朋友之间玩的扑克牌小游戏，不卖东西、不放广告。</p>

          <h2>我们存什么</h2>
          <ul>
            <li><b>账号</b>：用 Google 登录时，存你的 Google 账号编号、名字、邮箱和头像地址；用用户名登录时，存用户名和加密后的密码（看不到原密码）。</li>
            <li><b>你自己改的</b>：显示的名字、选的头像。</li>
            <li><b>小组和战绩</b>：你加入的小组、每局的输赢和剩牌、小组账本里的还款和调账记录。</li>
            <li><b>登录状态</b>：浏览器里一个登录 cookie，用来记住你是谁。</li>
          </ul>

          <h2>谁能看到</h2>
          <ul>
            <li>同一个小组的成员能看到你的名字、头像、在这个小组里的余额和战绩。</li>
            <li>你的邮箱不会给其他玩家看。</li>
            <li>我们不把任何数据卖给或者分享给第三方，也不用来做广告。数据存在服务器的数据库里。</li>
          </ul>

          <h2>删除</h2>
          <p>想删掉账号和所有记录，联系开这个游戏的人（你们小组的管理员会知道是谁），我们会把账号和相关记录删掉。退出登录会让这台设备上的登录失效。</p>

          <hr />

          <h2>In English</h2>
          <p>
            Big Two (大老二) is a card game played among friends. We store your Google account ID, name, email and profile
            picture (or your username and a hashed password), the display name and avatar you choose, the groups you join,
            your round results and your group ledger entries, plus a sign-in cookie. Other members of your groups can see
            your name, avatar, balance and stats in that group; your email is never shown to other players. We do not sell or
            share your data with third parties or use it for advertising. To have your account and records deleted, contact
            the person who runs this game.
          </p>
        </article>
      </div>
    </main>
  );
}
