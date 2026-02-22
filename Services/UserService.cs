using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using WatchList0._1.Data;

namespace WatchList0._1.Services
{
    // Database-backed implementation using ApplicationDbContext.
    public class UserService : IUserService
    {
        private readonly ApplicationDbContext _db;
        private readonly PasswordHasher<UserEntity> _passwordHasher = new();

        public UserService(ApplicationDbContext db)
        {
            _db = db;
        }

        public async Task<User?> AuthenticateAsync(string username, string password)
        {
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
                return null;

            var normalizedUsername = username.Trim();
            var userEntity = await _db.Users.FirstOrDefaultAsync(u => u.Username == normalizedUsername);
            if (userEntity is null)
                return null;

            PasswordVerificationResult verification;
            try
            {
                verification = _passwordHasher.VerifyHashedPassword(userEntity, userEntity.Password, password);
            }
            catch (FormatException)
            {
                verification = PasswordVerificationResult.Failed;
            }
            if (verification == PasswordVerificationResult.Failed)
            {
                if (!string.Equals(userEntity.Password, password, StringComparison.Ordinal))
                {
                    return null;
                }

                userEntity.Password = _passwordHasher.HashPassword(userEntity, password);
                await _db.SaveChangesAsync();
            }
            else if (verification == PasswordVerificationResult.SuccessRehashNeeded)
            {
                userEntity.Password = _passwordHasher.HashPassword(userEntity, password);
                await _db.SaveChangesAsync();
            }

            return new User(userEntity.Id, userEntity.Username);
        }

        public async Task<User?> GetByIdAsync(string id)
        {
            var userEntity = await _db.Users.FindAsync(id);
            if (userEntity is null) return null;
            return new User(userEntity.Id, userEntity.Username);
        }

        public async Task<User?> CreateUserAsync(string username, string password)
        {
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
                return null;

            var normalizedUsername = username.Trim();
            if (normalizedUsername.Length > 50 || password.Length > 200)
                return null;

            if (await _db.Users.AnyAsync(u => u.Username == normalizedUsername))
                return null;

            var id = System.Guid.NewGuid().ToString();
            var entity = new UserEntity { Id = id, Username = normalizedUsername, Password = string.Empty };
            entity.Password = _passwordHasher.HashPassword(entity, password);
            _db.Users.Add(entity);
            await _db.SaveChangesAsync();
            return new User(entity.Id, entity.Username);
        }
    }
}
