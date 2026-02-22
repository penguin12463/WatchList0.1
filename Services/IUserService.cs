using System.Threading.Tasks;

namespace WatchList0._1.Services
{
    public record User(string Id, string Username);

    public interface IUserService
    {
        Task<User?> AuthenticateAsync(string username, string password);
        Task<User?> GetByIdAsync(string id);
        Task<User?> CreateUserAsync(string username, string password);
    }
}
